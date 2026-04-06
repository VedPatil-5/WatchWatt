"""
╔══════════════════════════════════════════════════════════════╗
║         SMART ENERGY-SAVING HUMAN DETECTION SYSTEM          ║
║               v4.3 — Numpad Per-Pin Toggle                  ║
║           *** ACTIVE LOW — HW-281 Relay Compatible ***      ║
╚══════════════════════════════════════════════════════════════╝

Zone logic  : Based on bounding box WIDTH (how close the person is)
              Wider box  → closer to camera → lower bench number
              Narrower   → farther away     → higher bench number

ESP32 pins  : Each BENCH+SIDE combo maps to one GPIO pin.
              Python sends  PIN_HIGH:<n>  or  PIN_LOW:<n>
              ESP32 replies ACK:<cmd>  or  NACK:<cmd>

Relay logic : HW-281 is ACTIVE LOW
              Person DETECTED  → PIN_LOW  (relay ON  — light ON)
              Person GONE      → PIN_HIGH (relay OFF — light OFF)
              All pins init    → PIN_HIGH on startup (all relays OFF safe state)

Fix (v4.1)  : on_delay is now enforced PER PIN, not just once globally.
Fix (v4.2)  : off_delay is now enforced PER PIN as well.

New (v4.3)  : Numpad keys 1–8 toggle individual bench lights manually.
              Manually toggled-ON pins are added to manual_pins set and
              are IMMUNE to auto-off (detection logic will not turn them off).
              Pressing the same numpad key again turns the light OFF and
              removes it from manual_pins (auto logic resumes for that pin).

Numpad map  :
              [1] BENCH 1 LEFT   [2] BENCH 1 RIGHT
              [3] BENCH 2 LEFT   [4] BENCH 2 RIGHT
              [5] BENCH 3 LEFT   [6] BENCH 3 RIGHT
              [7] BENCH 4 LEFT   [8] BENCH 4 RIGHT

Controls    : [K] Toggle System  |  [A] All Lights  |  [1-8] Pin Toggle
              [R] Reset Stats    |  [ESC] Exit
"""

import os
import cv2
import time
import logging
import sys
import threading
import serial
import serial.tools.list_ports
from dataclasses import dataclass, field
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from ultralytics import YOLO


# ──────────────────────────────────────────────────────────────
#  LOGGING SETUP
# ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s]  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("detection_log.txt", mode="a", encoding="utf-8"),
    ],
)
log = logging.getLogger("SmartVision")

app = Flask(__name__)
CORS(app)
CONTROL_TOKEN = os.getenv("DETECTION_CONTROL_TOKEN", "")
FLASK_PORT = int(os.getenv("DETECTION_PORT", "5000"))
bridge_lock = threading.Lock()
latest_frame_jpeg = None
runtime = {"state": None, "esp": None}


# ──────────────────────────────────────────────────────────────
#  PIN MAP  — edit these to match your ESP32 wiring
# ──────────────────────────────────────────────────────────────
PIN_MAP: dict[tuple[str, str], int] = {
    ("BENCH 1", "LEFT"):  2,
    ("BENCH 1", "RIGHT"): 4,
    ("BENCH 2", "LEFT"):  5,
    ("BENCH 2", "RIGHT"): 18,
    ("BENCH 3", "LEFT"):  19,
    ("BENCH 3", "RIGHT"): 21,
    ("BENCH 4", "LEFT"):  22,
    ("BENCH 4", "RIGHT"): 23,
}


# ──────────────────────────────────────────────────────────────
#  NUMPAD KEY MAP
# ──────────────────────────────────────────────────────────────
NUMPAD_MAP: dict[int, tuple[str, str]] = {
    ord('1'): ("BENCH 1", "LEFT"),
    ord('2'): ("BENCH 1", "RIGHT"),
    ord('3'): ("BENCH 2", "LEFT"),
    ord('4'): ("BENCH 2", "RIGHT"),
    ord('5'): ("BENCH 3", "LEFT"),
    ord('6'): ("BENCH 3", "RIGHT"),
    ord('7'): ("BENCH 4", "LEFT"),
    ord('8'): ("BENCH 4", "RIGHT"),
}


# ──────────────────────────────────────────────────────────────
#  CONFIGURATION
# ──────────────────────────────────────────────────────────────
@dataclass
class Config:
    # Camera
    camera_index: int   = 1
    frame_width:  int   = 640
    frame_height: int   = 480

    # Detection
    yolo_model:     str   = "yolov8n.pt"
    confidence:     float = 0.60
    confirm_frames: int   = 3

    # Light timing
    on_delay:  float = 3.0
    off_delay: float = 7.0

    # Display
    show_fps:       bool = True
    show_grid:      bool = False
    show_countdown: bool = True

    # Width-based zone thresholds
    width_thresholds: tuple = (0.48, 0.25, 0.17)
    zone_labels:      tuple = ("BENCH 1", "BENCH 2", "BENCH 3", "BENCH 4")

    # ESP32 serial
    esp32_port:     str   = None
    esp32_baudrate: int   = 115200
    esp32_timeout:  float = 1.0

    # ── Log rate limiter ──────────────────────────────────────
    log_interval:   float = 3.0


CFG = Config()


# ──────────────────────────────────────────────────────────────
#  COLOUR PALETTE  (BGR)
# ──────────────────────────────────────────────────────────────
class Palette:
    GREEN        = (0,   220,  90)
    RED          = (0,    60, 220)
    ORANGE       = (0,   165, 255)
    WHITE        = (240, 240, 240)
    DARK         = (20,   20,  20)
    GREY         = (130, 130, 130)
    CYAN         = (220, 220,   0)
    YELLOW       = (0,   220, 220)
    ZONE_OVERLAY = (255, 255, 255)
    PURPLE       = (220,   0, 220)
    TEAL         = (180, 200,   0)


# ──────────────────────────────────────────────────────────────
#  DATA CLASSES
# ──────────────────────────────────────────────────────────────
@dataclass
class Detection:
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float
    bench_zone: str
    side:       str

    @property
    def box_width(self) -> int:
        return self.x2 - self.x1

    @property
    def box_height(self) -> int:
        return self.y2 - self.y1

    @property
    def center_x(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def label(self) -> str:
        return f"{self.bench_zone} | {self.side}  {self.confidence:.0%}"


@dataclass
class SystemState:
    light_on:           bool  = False
    system_enabled:     bool  = True
    detection_count:    int   = 0
    first_detect_time:  float = 0.0
    last_detected_time: float = 0.0
    total_on_events:    int   = 0
    peak_count:         int   = 0
    session_start:      float = field(default_factory=time.time)

    # Tracks which (bench, side) combos currently have their relay ACTIVE
    active_pins: set = field(default_factory=set)

    # ── Manual all-lights override (Key A) ───────────────────
    all_lights_override: bool = False

    # ── Numpad manually toggled-ON pins (v4.3) ───────────────
    # Pins in this set are IMMUNE to auto-off by detection logic.
    manual_pins: set = field(default_factory=set)

    # ── Rate limiter state ────────────────────────────────────
    last_log_time: dict = field(default_factory=dict)

    # ── Per-pin ON pending timers (v4.1) ─────────────────────
    pin_pending_since: dict = field(default_factory=dict)

    # ── Per-pin OFF pending timers (v4.2) ────────────────────
    pin_absent_since: dict = field(default_factory=dict)


def zone_side_for_index(index: int) -> tuple[str, str] | None:
    pairs = [
        ("BENCH 1", "LEFT"),
        ("BENCH 1", "RIGHT"),
        ("BENCH 2", "LEFT"),
        ("BENCH 2", "RIGHT"),
        ("BENCH 3", "LEFT"),
        ("BENCH 3", "RIGHT"),
        ("BENCH 4", "LEFT"),
        ("BENCH 4", "RIGHT"),
    ]
    return pairs[index] if 0 <= index < len(pairs) else None


def compute_light_states(state: SystemState) -> list[bool]:
    return [zone_side_for_index(i) in state.active_pins for i in range(8)]


def get_mode_label(state: SystemState) -> str:
    return "manual" if state.all_lights_override or state.manual_pins else "auto"


def serialize_runtime_state() -> dict:
    with bridge_lock:
        current = runtime["state"]
        online = current is not None
        if not current:
            return {
                "online": False,
                "people": 0,
                "lights_on": 0,
                "light_states": [False] * 8,
                "mode": "auto",
                "timestamp": time.time(),
            }
        light_states = compute_light_states(current)
        return {
            "online": current.system_enabled and online,
            "people": current.detection_count,
            "lights_on": sum(1 for value in light_states if value),
            "light_states": light_states,
            "mode": get_mode_label(current),
            "timestamp": time.time(),
        }


def authorize_request() -> bool:
    if not CONTROL_TOKEN:
        return True
    return request.headers.get("X-Control-Token", "") == CONTROL_TOKEN


def apply_remote_light(index: int, on: bool) -> dict:
    with bridge_lock:
        state = runtime["state"]
        esp = runtime["esp"]
        if state is None or esp is None:
            raise RuntimeError("Detection runtime not ready")

        zone_side = zone_side_for_index(index)
        if zone_side is None:
            raise ValueError("Invalid light index")

        bench, side = zone_side
        state.all_lights_override = False
        state.pin_pending_since.pop(zone_side, None)
        state.pin_absent_since.pop(zone_side, None)

        if on:
            state.manual_pins.add(zone_side)
            set_pin_low(bench, side, esp, state)
        else:
            state.manual_pins.discard(zone_side)
            set_pin_high(bench, side, esp, state)

        state.light_on = bool(state.active_pins)
        return serialize_runtime_state()


def restore_auto_mode() -> dict:
    with bridge_lock:
        state = runtime["state"]
        esp = runtime["esp"]
        if state is None or esp is None:
            raise RuntimeError("Detection runtime not ready")

        for bench, side in list(state.manual_pins):
            set_pin_high(bench, side, esp, state)
        state.manual_pins.clear()
        state.all_lights_override = False
        state.pin_pending_since.clear()
        state.pin_absent_since.clear()
        state.light_on = bool(state.active_pins)
        return serialize_runtime_state()


# ──────────────────────────────────────────────────────────────
#  ESP32 SERIAL MANAGER
# ──────────────────────────────────────────────────────────────
class ESP32Serial:
    ESP32_CHIPS = ("CH340", "CP210", "FTDI", "USB Serial", "Silicon Labs")

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.ser = None
        self._connect()

    def _find_port(self) -> str | None:
        log.info("Scanning serial ports for ESP32 …")
        ports = serial.tools.list_ports.comports()
        if not ports:
            log.warning("No serial ports found.")
            return None
        for p in ports:
            desc = (p.description or "") + (p.manufacturer or "")
            log.info(f"  Port found: {p.device:15s} — {p.description}")
            if any(chip in desc for chip in self.ESP32_CHIPS):
                log.info(f"  ✔  ESP32 detected on {p.device}")
                return p.device
        log.warning("No ESP32-like chip found — using first available port.")
        return ports[0].device

    def _connect(self) -> None:
        port = self.cfg.esp32_port or self._find_port()
        if not port:
            log.error("ESP32: No port available — running WITHOUT ESP32.")
            return
        try:
            self.ser = serial.Serial(
                port=port,
                baudrate=self.cfg.esp32_baudrate,
                timeout=self.cfg.esp32_timeout,
            )
            time.sleep(2)
            self.ser.reset_input_buffer()
            log.info(f"ESP32: Connected on {port} @ {self.cfg.esp32_baudrate} baud ✔")

            log.info("ESP32: Initialising all relay pins HIGH (relays OFF — active-low safe state) …")
            for (bench, side), pin in PIN_MAP.items():
                cmd = f"PIN_HIGH:{pin}"
                self.send(cmd)
                log.info(f"  INIT ──► GPIO {pin} HIGH  ({bench} {side}) — relay OFF")

        except serial.SerialException as exc:
            log.error(f"ESP32: Could not open {port} — {exc}")
            self.ser = None

    def send(self, command: str) -> None:
        if self.ser is None or not self.ser.is_open:
            log.warning(f"ESP32: NOT CONNECTED — skipping '{command}'")
            return
        try:
            self.ser.reset_input_buffer()
            self.ser.write((command.strip() + "\n").encode("utf-8"))
            log.info(f"ESP32 TX ──► '{command}'")

            raw = self.ser.readline()
            if not raw:
                log.warning(
                    f"ESP32 RX: NO RESPONSE for '{command}' "
                    f"(timeout {self.cfg.esp32_timeout}s) — check wiring/firmware/baud"
                )
                return

            response = raw.decode("utf-8", errors="replace").strip()
            log.info(f"ESP32 RX ◄── '{response}'")

            if response.upper().startswith("ACK"):
                log.info(f"ESP32 ✔  ACCEPTED  cmd='{command}'  reply='{response}'")
            elif response.upper().startswith("NACK"):
                log.warning(f"ESP32 ✘  REJECTED  cmd='{command}'  reply='{response}'")
            else:
                log.info(f"ESP32 ℹ  INFO      cmd='{command}'  reply='{response}'")

        except serial.SerialException as exc:
            log.error(f"ESP32 serial error on '{command}': {exc}")

    def drain(self) -> None:
        if self.ser is None or not self.ser.is_open:
            return
        while self.ser.in_waiting:
            raw = self.ser.readline()
            if raw:
                msg = raw.decode("utf-8", errors="replace").strip()
                if msg:
                    log.info(f"ESP32 BOOT ◄── '{msg}'")

    def close(self) -> None:
        if self.ser and self.ser.is_open:
            self.ser.close()
            log.info("ESP32: Port closed.")


# ──────────────────────────────────────────────────────────────
#  PIN CONTROL  — ACTIVE LOW for HW-281 relay
# ──────────────────────────────────────────────────────────────
def set_pin_low(bench: str, side: str, esp: ESP32Serial,
                state: SystemState) -> None:
    key = (bench, side)
    pin = PIN_MAP.get(key)
    if pin is None:
        log.warning(f"PIN MAP: No pin defined for {bench} {side} — skipping")
        return
    if key in state.active_pins:
        return
    state.active_pins.add(key)
    cmd = f"PIN_LOW:{pin}"
    log.info(f"PIN CTRL ──► GPIO {pin} LOW   ({bench} {side})  relay ON")
    esp.send(cmd)


def set_pin_high(bench: str, side: str, esp: ESP32Serial,
                 state: SystemState) -> None:
    key = (bench, side)
    pin = PIN_MAP.get(key)
    if pin is None:
        return
    if key not in state.active_pins:
        return
    state.active_pins.discard(key)
    state.last_log_time.pop(key, None)
    cmd = f"PIN_HIGH:{pin}"
    log.info(f"PIN CTRL ──► GPIO {pin} HIGH  ({bench} {side})  relay OFF")
    esp.send(cmd)


def release_all_pins(esp: ESP32Serial, state: SystemState) -> None:
    for (bench, side) in list(state.active_pins):
        set_pin_high(bench, side, esp, state)


def activate_all_pins(esp: ESP32Serial, state: SystemState) -> None:
    """Force every pin LOW (relay ON) regardless of detection state."""
    for (bench, side) in PIN_MAP:
        set_pin_low(bench, side, esp, state)


# ──────────────────────────────────────────────────────────────
#  CAMERA
# ──────────────────────────────────────────────────────────────
def open_camera(cfg: Config) -> cv2.VideoCapture:
    for idx in (cfg.camera_index, 1 - cfg.camera_index):
        cap = cv2.VideoCapture(idx)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH,  cfg.frame_width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.frame_height)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            log.info(f"Camera opened on index {idx}")
            return cap
        cap.release()
    raise RuntimeError("No camera found. Check connection and index.")


# ──────────────────────────────────────────────────────────────
#  ZONE CLASSIFIER
# ──────────────────────────────────────────────────────────────
def classify_zone(x1: int, x2: int, frame_w: int,
                  cfg: Config) -> tuple[str, str]:
    box_width      = x2 - x1
    width_fraction = box_width / frame_w

    zone = cfg.zone_labels[-1]
    for i, threshold in enumerate(cfg.width_thresholds):
        if width_fraction >= threshold:
            zone = cfg.zone_labels[i]
            break

    side = "LEFT" if (x1 + x2) / 2 < frame_w / 2 else "RIGHT"
    return zone, side


# ──────────────────────────────────────────────────────────────
#  YOLO DETECTION
# ──────────────────────────────────────────────────────────────
def run_detection(model: YOLO, frame, cfg: Config,
                  frame_w: int, frame_h: int) -> list[Detection]:
    results = model(frame, classes=[0], conf=cfg.confidence, verbose=False)
    detections: list[Detection] = []
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            conf = float(box.conf[0])
            zone, side = classify_zone(x1, x2, frame_w, cfg)
            detections.append(Detection(x1, y1, x2, y2, conf, zone, side))
    return detections


# ──────────────────────────────────────────────────────────────
#  LIGHT + PIN CONTROL
# ──────────────────────────────────────────────────────────────
def update_light_and_pins(
    state: SystemState,
    detections: list[Detection],
    confirmed: bool,
    current_time: float,
    cfg: Config,
    esp: ESP32Serial,
) -> None:

    # ── System kill switch ────────────────────────────────────
    if not state.system_enabled:
        if state.light_on:
            log.warning("LIGHT OFF  — system disabled (kill switch)")
            state.light_on = False
            state.pin_pending_since.clear()
            state.pin_absent_since.clear()
            release_all_pins(esp, state)
        return

    # ── Manual all-lights override — skip detection logic ─────
    if state.all_lights_override:
        return

    # ── Presence confirmed → lights ON ───────────────────────
    if confirmed:
        if state.first_detect_time == 0.0:
            state.first_detect_time = current_time

        if not state.light_on and (
                current_time - state.first_detect_time >= cfg.on_delay):
            log.info("LIGHT ON   — human presence confirmed")
            state.light_on = True
            state.total_on_events += 1

        state.last_detected_time = current_time

        if state.light_on:
            currently_seen: set[tuple[str, str]] = set()

            for det in detections:
                key = (det.bench_zone, det.side)
                currently_seen.add(key)
                pin = PIN_MAP.get(key, "?")

                # ── If this key was previously marked absent, cancel that timer ──
                if key in state.pin_absent_since:
                    state.pin_absent_since.pop(key)
                    log.info(
                        f"PIN OFF-DELAY CANCELLED  →  {det.bench_zone} {det.side}  "
                        f"— person returned before off_delay elapsed"
                    )

                # ── Start per-pin ON pending timer on first appearance ──
                if key not in state.pin_pending_since:
                    state.pin_pending_since[key] = current_time
                    log.info(
                        f"PIN PENDING  →  {det.bench_zone} {det.side}  "
                        f"(conf={det.confidence:.0%})  "
                        f"— confirming for {cfg.on_delay:.1f}s …"
                    )

                # ── Only activate relay after on_delay has elapsed ───
                elapsed = current_time - state.pin_pending_since[key]
                if elapsed >= cfg.on_delay:
                    last = state.last_log_time.get(key, 0.0)
                    if current_time - last >= cfg.log_interval:
                        log.info(
                            f"PERSON DETECTED  →  {det.bench_zone} {det.side}  "
                            f"(conf={det.confidence:.0%})  →  GPIO {pin} LOW (relay ON)"
                        )
                        state.last_log_time[key] = current_time

                    set_pin_low(det.bench_zone, det.side, esp, state)

            # ── For active pins no longer seen: start per-pin off-delay timer ──
            # SKIP pins that are manually held ON via numpad (manual_pins).
            for key in list(state.active_pins):
                if key not in currently_seen and key not in state.manual_pins:
                    bench, side = key
                    pin = PIN_MAP.get(key, "?")
                    if key not in state.pin_absent_since:
                        state.pin_absent_since[key] = current_time
                        log.info(
                            f"PIN OFF-DELAY STARTED  →  {bench} {side}  "
                            f"→  GPIO {pin} will go HIGH in {cfg.off_delay:.0f}s "
                            f"if person does not return"
                        )
                    else:
                        absent_for = current_time - state.pin_absent_since[key]
                        if absent_for >= cfg.off_delay:
                            log.info(
                                f"PERSON LEFT      →  {bench} {side}  "
                                f"(absent {absent_for:.1f}s)  "
                                f"→  GPIO {pin} HIGH (relay OFF)"
                            )
                            state.pin_absent_since.pop(key)
                            set_pin_high(bench, side, esp, state)

            # ── Clean up pending ON timers for keys no longer seen ──
            for key in list(state.pin_pending_since):
                if key not in currently_seen:
                    state.pin_pending_since.pop(key, None)

    # ── No presence → countdown to global lights OFF ──────────
    else:
        state.first_detect_time = 0.0
        state.pin_pending_since.clear()

        # Start absent timers for active pins not seen — skip manual_pins
        for key in list(state.active_pins):
            if key not in state.pin_absent_since and key not in state.manual_pins:
                state.pin_absent_since[key] = current_time

        # Fire off any pins whose off_delay has elapsed — skip manual_pins
        for key in list(state.pin_absent_since):
            if key in state.manual_pins:
                continue
            absent_for = current_time - state.pin_absent_since[key]
            if absent_for >= cfg.off_delay:
                bench, side = key
                pin = PIN_MAP.get(key, "?")
                log.info(
                    f"PERSON LEFT      →  {bench} {side}  "
                    f"(absent {absent_for:.1f}s)  "
                    f"→  GPIO {pin} HIGH (relay OFF)"
                )
                state.pin_absent_since.pop(key)
                set_pin_high(bench, side, esp, state)

        # Global light-off only after all non-manual pins are off and off_delay elapsed
        non_manual_active = state.active_pins - state.manual_pins
        if state.light_on and not non_manual_active and (
                current_time - state.last_detected_time >= cfg.off_delay):
            log.info(f"LIGHT OFF  — no presence for {cfg.off_delay:.0f}s")
            state.light_on = False
            state.pin_absent_since.clear()


# ──────────────────────────────────────────────────────────────
#  DRAW — ZONE GRID
# ──────────────────────────────────────────────────────────────
def draw_zone_grid(frame, frame_w: int, frame_h: int,
                   cfg: Config) -> None:
    overlay = frame.copy()
    for i, t in enumerate(cfg.width_thresholds):
        half = int((t * frame_w) / 2)
        cx   = frame_w // 2
        cv2.line(overlay, (cx - half, 0), (cx - half, frame_h),
                 Palette.ZONE_OVERLAY, 1)
        cv2.line(overlay, (cx + half, 0), (cx + half, frame_h),
                 Palette.ZONE_OVERLAY, 1)
        label_x = cx + half + 4
        label_y = 20 + i * 18
        if label_x < frame_w - 60:
            cv2.putText(overlay, cfg.zone_labels[i], (label_x, label_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, Palette.ZONE_OVERLAY,
                        1, cv2.LINE_AA)
    cv2.line(overlay, (frame_w // 2, 0), (frame_w // 2, frame_h),
             Palette.ZONE_OVERLAY, 1)
    cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)


# ──────────────────────────────────────────────────────────────
#  DRAW — BOUNDING BOXES
# ──────────────────────────────────────────────────────────────
def draw_detections(frame, detections: list[Detection],
                    frame_w: int) -> None:
    for det in detections:
        cv2.rectangle(frame, (det.x1, det.y1), (det.x2, det.y2),
                      Palette.GREEN, 2)
        width_pct  = f"w={det.box_width / frame_w:.0%}"
        full_label = f"{det.label}  [{width_pct}]"
        (tw, th), _ = cv2.getTextSize(
            full_label, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)
        lx, ly = det.x1, det.y1 - 12
        cv2.rectangle(frame, (lx, ly - th - 4),
                      (lx + tw + 6, ly + 4), Palette.DARK, -1)
        cv2.putText(frame, full_label, (lx + 3, ly),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, Palette.GREEN,
                    1, cv2.LINE_AA)


# ──────────────────────────────────────────────────────────────
#  DRAW — HUD PANEL
# ──────────────────────────────────────────────────────────────
def draw_hud(frame, state: SystemState, detections: list[Detection],
             fps: float, current_time: float, cfg: Config) -> None:
    frame_h, frame_w = frame.shape[:2]
    panel_w = 240

    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (panel_w, 230), Palette.DARK, -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)

    def put(text: str, y: int, color=Palette.WHITE,
            scale: float = 0.60) -> None:
        cv2.putText(frame, text, (10, y),
                    cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)

    put(f"SYSTEM : {'ON'  if state.system_enabled else 'OFF'}", 22,
        Palette.GREEN if state.system_enabled else Palette.RED, 0.62)
    put(f"LIGHT  : {'ON'  if state.light_on else 'OFF'}", 46,
        Palette.GREEN if state.light_on else Palette.RED, 0.62)
    put(f"MANUAL : {'ALL ON' if state.all_lights_override else 'OFF'}", 70,
        Palette.PURPLE if state.all_lights_override else Palette.GREY, 0.62)

    # ── Show numpad-pinned lights ─────────────────────────────
    if state.manual_pins:
        pinned_labels = ", ".join(
            f"{b[-1]}{s[0]}" for b, s in sorted(state.manual_pins)
        )
        put(f"PINNED : {pinned_labels}", 94, Palette.TEAL, 0.55)
    else:
        put("PINNED : none", 94, Palette.GREY, 0.55)

    put(f"PEOPLE : {len(detections)}",       118, Palette.YELLOW, 0.62)
    put(f"EVENTS : {state.total_on_events}", 142, Palette.CYAN,   0.58)
    put(f"PEAK   : {state.peak_count}",      166, Palette.GREY,   0.55)

    uptime = int(current_time - state.session_start)
    h, m, s = uptime // 3600, (uptime % 3600) // 60, uptime % 60
    put(f"UPTIME : {h:02d}:{m:02d}:{s:02d}", 190, Palette.GREY, 0.55)

    if cfg.show_fps:
        put(f"FPS    : {fps:.1f}", 214, Palette.GREY, 0.50)

    # ── Manual override banner ────────────────────────────────
    if state.all_lights_override:
        banner = "  *** MANUAL OVERRIDE — ALL LIGHTS ON ***  "
        (bw, bh), _ = cv2.getTextSize(
            banner, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        bx = (frame_w - bw) // 2
        by = frame_h - 30
        cv2.rectangle(frame, (bx - 6, by - bh - 6),
                      (bx + bw + 6, by + 6), Palette.PURPLE, -1)
        cv2.putText(frame, banner, (bx, by),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, Palette.WHITE,
                    1, cv2.LINE_AA)

    # ── Numpad pins active banner ─────────────────────────────
    elif state.manual_pins:
        count = len(state.manual_pins)
        banner = f"  *** NUMPAD: {count} PIN{'S' if count > 1 else ''} MANUALLY ON ***  "
        (bw, bh), _ = cv2.getTextSize(
            banner, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)
        bx = (frame_w - bw) // 2
        by = frame_h - 30
        cv2.rectangle(frame, (bx - 6, by - bh - 6),
                      (bx + bw + 6, by + 6), Palette.TEAL, -1)
        cv2.putText(frame, banner, (bx, by),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, Palette.DARK,
                    1, cv2.LINE_AA)

    if (cfg.show_countdown and state.light_on
            and state.detection_count < cfg.confirm_frames
            and state.last_detected_time > 0):
        remaining = max(
            0.0, cfg.off_delay - (current_time - state.last_detected_time))
        txt = f"OFF IN {remaining:.1f}s"
        (tw, _), _ = cv2.getTextSize(
            txt, cv2.FONT_HERSHEY_SIMPLEX, 0.60, 1)
        cv2.putText(frame, txt, (frame_w - tw - 10, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.60, Palette.ORANGE,
                    1, cv2.LINE_AA)

    if (not state.light_on and state.system_enabled
            and state.first_detect_time > 0.0
            and not state.all_lights_override):
        pct   = min(
            (current_time - state.first_detect_time) / cfg.on_delay, 1.0)
        bar_w = int(panel_w * pct)
        cv2.rectangle(frame, (0, 228), (bar_w, 235), Palette.ORANGE, -1)
        put("CONFIRMING...", 225, Palette.ORANGE, 0.45)

    state.peak_count = max(state.peak_count, len(detections))

    hint = "[K] Toggle  [A] All  [1-8] Pin  [R] Reset  [ESC] Exit"
    (hw, _), _ = cv2.getTextSize(hint, cv2.FONT_HERSHEY_SIMPLEX, 0.40, 1)
    cv2.putText(frame, hint, ((frame_w - hw) // 2, frame_h - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.40, Palette.GREY, 1, cv2.LINE_AA)


def generate_frames():
    global latest_frame_jpeg
    while True:
        frame = latest_frame_jpeg
        if frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.033)


@app.route('/detection_feed')
def detection_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/status')
def status():
    return jsonify(serialize_runtime_state())


@app.route('/snapshot')
def snapshot():
    if not latest_frame_jpeg:
        return "No frame", 503
    return Response(latest_frame_jpeg, mimetype='image/jpeg')


@app.route('/control/lights/<int:index>', methods=['POST'])
def control_single_light(index: int):
    if not authorize_request():
        return jsonify({"error": "Unauthorized"}), 401
    payload = request.get_json(silent=True) or {}
    if 'on' not in payload:
        return jsonify({"error": "on boolean required"}), 400
    try:
        return jsonify(apply_remote_light(index, bool(payload['on'])))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


@app.route('/control/auto', methods=['POST'])
def control_auto():
    if not authorize_request():
        return jsonify({"error": "Unauthorized"}), 401
    try:
        return jsonify(restore_auto_mode())
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503


# ──────────────────────────────────────────────────────────────
#  FPS TRACKER
# ──────────────────────────────────────────────────────────────
class FPSTracker:
    def __init__(self, window: int = 30):
        self._times: list[float] = []
        self._window = window

    def tick(self) -> float:
        now = time.time()
        self._times.append(now)
        if len(self._times) > self._window:
            self._times.pop(0)
        if len(self._times) < 2:
            return 0.0
        return (len(self._times) - 1) / (self._times[-1] - self._times[0])


# ──────────────────────────────────────────────────────────────
#  MAIN
# ──────────────────────────────────────────────────────────────
def main() -> None:
    global latest_frame_jpeg
    log.info("SmartVision v4.3 — Numpad Per-Pin Toggle — starting up")
    log.info("*** ACTIVE LOW mode — HW-281 relay: LOW = ON, HIGH = OFF ***")
    log.info(f"Width thresholds : {CFG.width_thresholds} → zones: {CFG.zone_labels}")
    log.info(f"on_delay={CFG.on_delay}s  off_delay={CFG.off_delay}s  "
             f"confirm_frames={CFG.confirm_frames}  confidence={CFG.confidence}")
    log.info(f"log_interval={CFG.log_interval}s  "
             f"(PERSON DETECTED repeats at most once every {CFG.log_interval:.0f}s)")
    log.info("PIN MAP:")
    for (bench, side), pin in PIN_MAP.items():
        log.info(f"  {bench} {side:5s} → GPIO {pin}")
    log.info("NUMPAD MAP:")
    for keycode, (bench, side) in NUMPAD_MAP.items():
        log.info(f"  [{chr(keycode)}] → {bench} {side}")

    esp = ESP32Serial(CFG)
    esp.drain()

    try:
        model = YOLO(CFG.yolo_model)
    except Exception as exc:
        log.critical(f"Failed to load YOLO model: {exc}")
        esp.close()
        sys.exit(1)

    try:
        cap = open_camera(CFG)
    except RuntimeError as exc:
        log.critical(str(exc))
        esp.close()
        sys.exit(1)

    state       = SystemState()
    fps_tracker = FPSTracker()
    with bridge_lock:
        runtime["state"] = state
        runtime["esp"] = esp
    threading.Thread(
        target=lambda: app.run(host='0.0.0.0', port=FLASK_PORT, threaded=True, use_reloader=False),
        daemon=True,
    ).start()
    log.info(f"Flask bridge listening on http://127.0.0.1:{FLASK_PORT}")
    log.info("System ready — watching for humans …")

    while True:
        ret, frame = cap.read()
        if not ret:
            log.warning("Frame grab failed — retrying...")
            time.sleep(0.03)
            continue

        frame            = cv2.resize(frame, (CFG.frame_width, CFG.frame_height))
        frame_h, frame_w = frame.shape[:2]
        current_time     = time.time()
        fps              = fps_tracker.tick()

        esp.drain()

        detections = run_detection(model, frame, CFG, frame_w, frame_h)

        if detections:
            state.detection_count = min(
                state.detection_count + 1, CFG.confirm_frames + 1)
        else:
            state.detection_count = 0

        confirmed = state.detection_count >= CFG.confirm_frames

        update_light_and_pins(
            state, detections, confirmed, current_time, CFG, esp)

        if CFG.show_grid:
            draw_zone_grid(frame, frame_w, frame_h, CFG)

        draw_detections(frame, detections, frame_w)
        draw_hud(frame, state, detections, fps, current_time, CFG)

        success, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if success:
            latest_frame_jpeg = buffer.tobytes()

        cv2.imshow("SmartVision v4.3", frame)

        key = cv2.waitKey(1) & 0xFF

        # ── [K] System toggle ─────────────────────────────────
        if key == ord('k'):
            state.system_enabled = not state.system_enabled
            if not state.system_enabled and state.all_lights_override:
                state.all_lights_override = False
                log.info("MANUAL OVERRIDE cancelled — system disabled by kill switch")
            if not state.system_enabled:
                # Clear manual pins too when system is killed
                state.manual_pins.clear()
                log.info("NUMPAD pins cleared — system disabled by kill switch")
            log.info(
                f"System {'ENABLED' if state.system_enabled else 'DISABLED'}"
                " by user")

        # ── [A] All-lights override ───────────────────────────
        elif key == ord('a'):
            state.all_lights_override = not state.all_lights_override
            if state.all_lights_override:
                log.info("MANUAL OVERRIDE ON  — all lights forced ON by user [A]")
                activate_all_pins(esp, state)
            else:
                log.info("MANUAL OVERRIDE OFF — releasing all lights [A]")
                state.pin_pending_since.clear()
                state.pin_absent_since.clear()
                state.manual_pins.clear()
                release_all_pins(esp, state)
                state.light_on = False

        # ── [1-8] Numpad per-pin toggle ───────────────────────
        elif key in NUMPAD_MAP:
            bench, side = NUMPAD_MAP[key]
            key_tuple = (bench, side)

            if key_tuple in state.manual_pins:
                # Already manually ON → turn it OFF, remove from manual_pins
                state.manual_pins.discard(key_tuple)
                state.pin_pending_since.pop(key_tuple, None)
                state.pin_absent_since.pop(key_tuple, None)
                set_pin_high(bench, side, esp, state)
                log.info(
                    f"NUMPAD OFF  →  {bench} {side}  (key '{chr(key)}')  "
                    f"— removed from manual_pins, auto logic resumes"
                )
            else:
                # Not manually ON → turn it ON and protect from auto-off
                state.manual_pins.add(key_tuple)
                state.pin_pending_since.pop(key_tuple, None)
                state.pin_absent_since.pop(key_tuple, None)
                set_pin_low(bench, side, esp, state)
                log.info(
                    f"NUMPAD ON   →  {bench} {side}  (key '{chr(key)}')  "
                    f"— added to manual_pins, immune to auto-off"
                )

        # ── [R] Reset stats ───────────────────────────────────
        elif key == ord('r'):
            state.total_on_events   = 0
            state.peak_count        = 0
            state.session_start     = time.time()
            state.detection_count   = 0
            state.first_detect_time = 0.0
            state.pin_pending_since.clear()
            state.pin_absent_since.clear()
            # Note: manual_pins and active_pins are NOT reset — lights stay as-is
            log.info("Stats reset by user (active lights unchanged)")

        # ── [ESC] Exit ────────────────────────────────────────
        elif key == 27:
            log.info("Exit requested by user")
            break

    uptime = int(time.time() - state.session_start)
    log.info(f"Session ended — uptime {uptime}s | "
             f"ON events: {state.total_on_events} | peak: {state.peak_count}")

    release_all_pins(esp, state)
    with bridge_lock:
        runtime["state"] = None
        runtime["esp"] = None
    cap.release()
    cv2.destroyAllWindows()
    esp.close()
    log.info("Resources released. Goodbye.")


if __name__ == "__main__":
    main()
