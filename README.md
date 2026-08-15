# WatchWatt — Smart Energy Management System

WatchWatt is an end-to-end smart energy management system that autonomously controls artificial lighting based on real-time human presence detection. By fusing computer vision, IoT hardware, and a full-stack web platform, WatchWatt eliminates the single most avoidable source of energy waste in institutional buildings — lights burning in unoccupied spaces.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Hardware Components](#hardware-components)
- [Software Architecture](#software-architecture)
- [Core Algorithm](#core-algorithm)
- [ESP32 Firmware](#esp32-firmware)
- [System Workflow](#system-workflow)
- [Key Features](#key-features)
- [Results](#results)
- [Getting Started](#getting-started)

---

## Overview

Lighting accounts for approximately **15% of global electricity consumption**. In institutional environments — classrooms, laboratories, lecture halls — a disproportionate share is consumed in completely unoccupied spaces.

WatchWatt solves this by delivering:

| Metric | Value |
|---|---|
| Detection Accuracy | ≥ 60% confidence threshold (YOLOv8n) |
| Response Latency | < 3 seconds (on_delay) |
| Zones Controlled | 8 independent circuits (4 benches × 2 sides) |
| Off-Delay Safety | 7 seconds per-pin debounce |
| Communication | 115,200 baud UART serial |

---

## System Architecture

WatchWatt follows a layered, event-driven architecture connecting perception, decision, actuation, and monitoring layers into a cohesive pipeline. Each layer operates independently, with graceful degradation when hardware is unavailable.

| Layer | Component | Technology |
|---|---|---|
| **Perception** | Camera Feed | OpenCV VideoCapture (640×480) |
| **Intelligence** | Detection Engine | YOLOv8n (Ultralytics) |
| **Decision** | Zone Classifier | SmartVision v4.2 (Python) |
| **Communication** | Serial Link | PySerial @ 115,200 baud UART |
| **Actuation** | Relay Controller | ESP32 + HW-281 8-Channel Relay |
| **Monitoring** | Web Dashboard | Flask + MongoDB · Railway Deployment |
---

## Technology Stack

### Hardware
| Component | Role |
|---|---|
| **ESP32 Dev Module** | Main MCU — WiFi-capable, handles all GPIO relay control |
| **HW-281 8-Channel Relay** | Opto-isolated, active-low, 10A/250VAC rated |
| **8 Light Bulbs** | Simulated room lighting fixtures |
| **USB-UART Bridge (CH340/CP210x)** | Python–ESP32 serial communication |

### Software
| Component | Role |
|---|---|
| **Python 3.x** | Primary application language for detection and control |
| **YOLOv8n (Ultralytics)** | Real-time object detection model |
| **OpenCV** | Frame capture, image processing, and HUD rendering |
| **PySerial** | UART communication with ESP32 relay board |

### Platform
| Component | Role |
|---|---|
| **Flask** | REST API backend managing auth, logging, and device state |
| **MongoDB** | NoSQL database for user data, sessions, and event logs |
| **Railway App** | Cloud deployment with CI/CD pipeline |
| **Brew-Gmail API** | Programmatic email notifications for system events |

---

## Hardware Components

The demonstration unit replicates a real classroom environment with **8 individually switchable light circuits** across **4 bench zones**.

### GPIO Pin Mapping

| GPIO Pin | Relay Input | Zone | Side |
|---|---|---|---|
| GPIO 2 | IN1 | Bench 1 | LEFT |
| GPIO 4 | IN2 | Bench 1 | RIGHT |
| GPIO 5 | IN3 | Bench 2 | LEFT |
| GPIO 18 | IN4 | Bench 2 | RIGHT |
| GPIO 19 | IN5 | Bench 3 | LEFT |
| GPIO 21 | IN6 | Bench 3 | RIGHT |
| GPIO 22 | IN7 | Bench 4 | LEFT |
| GPIO 23 | IN8 | Bench 4 | RIGHT |

> **Wiring Note:** The ESP32 and relay coils operate on **5V DC** from USB, while the bulb circuits carry **220V AC** through the relay contacts.

---

## Software Architecture

The core application (`SmartVision v4.2`) is a ~790-line Python module implementing a real-time perception-actuation loop, architected with clean separation of concerns across five functional domains:

```
smartvision/
├── Config           # Centralised typed configuration (zero magic numbers)
├── ESP32Serial      # Serial communication, port auto-detection, ACK/NACK parsing
├── Detection Engine # YOLOv8n inference, confidence filtering, typed Detection objects
├── Zone Classifier  # Bounding-box → bench zone → GPIO pin mapping
└── State Machine    # Per-pin ON/OFF delay timers, override flags, session statistics
```

### `ESP32Serial`
Auto-detects the ESP32 port by scanning for known USB-UART chip descriptions (CH340, CP210x, FTDI, Silicon Labs). Sends `PIN_HIGH` / `PIN_LOW` commands and parses `ACK` / `NACK` responses with timeout logging.

### `SystemState` (v4.2)
The heart of the system — manages per-pin ON and OFF delay timers, active pin sets, manual override flags, and session statistics. Implements the **v4.2 per-pin off-delay fix** that prevents relay chatter.

---

## Core Algorithm

### Zone Classification via Bounding Box Width

WatchWatt uses the **width of the detected person's bounding box** relative to frame width as a monocular depth estimator — no depth camera or LiDAR required. A person close to the camera occupies a larger fraction of the frame than someone further away.

| Zone | Width Fraction | Interpretation | GPIO Pins |
|---|---|---|---|
| Bench 1 | ≥ 48% of frame | Very close — front row | GPIO 2 (L), GPIO 4 (R) |
| Bench 2 | ≥ 25% of frame | Close — second row | GPIO 5 (L), GPIO 18 (R) |
| Bench 3 | ≥ 17% of frame | Mid-distance — third row | GPIO 19 (L), GPIO 21 (R) |
| Bench 4 | < 17% of frame | Far — back row | GPIO 22 (L), GPIO 23 (R) |

### Per-Pin Delay State Machine (v4.2)

| Mechanism | Version | Parameter | Purpose |
|---|---|---|---|
| Per-Pin ON Delay | v4.1 | `on_delay = 3.0s` | Relay activates only after 3s of continuous presence |
| Per-Pin OFF Delay | v4.2 | `off_delay = 7.0s` | Relay deactivates only after 7s of continuous absence |
| Confirm Frames | v4.0 | `confirm_frames = 3` | Presence registered only after 3 consecutive detection frames |

### Keyboard Controls

| Key | Action |
|---|---|
| `K` | Toggle system on/off (kill switch — releases all relay pins) |
| `A` | Manual override — forces all 8 lights ON |
| `R` | Reset session statistics |
| `ESC` | Graceful shutdown — releases all pins, closes serial port and camera |

---

## ESP32 Firmware

The ESP32 runs a purpose-built Arduino sketch acting as a deterministic relay driver.

### Serial Protocol

```
# Turn ON  → Bench 1 LEFT
Python TX  →  "PIN_LOW:2"
ESP32 RX   →  "ACK:PIN_LOW:2"

# Turn OFF → Bench 1 LEFT
Python TX  →  "PIN_HIGH:2"
ESP32 RX   →  "ACK:PIN_HIGH:2"
```

### Safety Design

- **Safe Boot State:** All 8 relay pins are set `HIGH` before being configured as outputs — guaranteeing relays are OFF during any power cycle or firmware reset.
- **Pin Validation:** `isValidPin()` validates every received GPIO number against the hardcoded `RELAY_PINS` array `{2, 4, 5, 18, 19, 21, 22, 23}` before executing any `digitalWrite`.
- **Non-Blocking I/O:** `loop()` returns immediately if no serial data is available — the firmware never blocks.

---

## System Workflow

```
1. USER AUTHENTICATION
   └─ OTP email verification (Brew-Gmail API) → Admin approval → JWT session

2. SYSTEM INITIALISATION
   └─ All GPIO pins → HIGH (relays OFF) → YOLOv8n loads → Camera opens → ESP32 auto-detected

3. CONTINUOUS FRAME ANALYSIS
   └─ Capture 640×480 frame → YOLOv8n inference (class=[0], confidence ≥ 60%)

4. ZONE ASSIGNMENT
   └─ Bounding box width fraction → Bench 1–4
   └─ Horizontal centre → LEFT / RIGHT

5. PER-PIN DELAY LOGIC
   └─ New zone detected → Start ON timer (3.0s) → Activate relay
   └─ Zone absent → Start OFF timer (7.0s) → Deactivate relay

6. RELAY ACTUATION
   └─ PIN_LOW / PIN_HIGH → UART → ESP32 validates → Executes → ACK/NACK logged

7. DASHBOARD MONITORING
   └─ Flask logs all events to MongoDB → Admin views real-time zone status + 3D interface
```

---

## Key Features

- **Distance-Based Zone Detection** — Single standard webcam delivers 8-zone spatial awareness using YOLOv8 bounding box width as a monocular depth proxy. No depth sensor required.
- **Per-Pin Debounce Architecture** — Every relay channel has its own independent ON and OFF delay timer, eliminating relay chatter and correctly handling simultaneous multi-zone occupancy changes.
- **Secure Multi-User Access** — OTP-verified registration, admin-managed access control, and JWT-based session management.
- **3D Spatial Dashboard** — Administrators visualise the physical room in a 3D rendered interface with per-circuit manual override controls.
- **Fault-Tolerant Design** — Operates gracefully without ESP32 connection, handles camera failures, logs all NACK responses, and initialises to a safe OFF state on every boot.
- **Session Analytics** — Built-in event counting, peak occupancy tracking, uptime monitoring, and rate-limited logging for energy auditing.

---

## Results

Testing of the WatchWatt demonstration system validated all core design hypotheses:

| Outcome | Result |
|---|---|
| **Real-Time Detection** | YOLOv8n runs at 15–30 FPS on consumer hardware with stable classification across varying lighting and angles |
| **Zone Accuracy** | Width-fraction classifier correctly distinguishes all 4 bench distances with graceful boundary transitions |
| **Relay Stability** | v4.2 per-pin off-delay completely eliminates relay chatter — zero spurious events in 30-minute test sessions |
| **Hardware Reliability** | HW-281 responded to 100% of commands with ACK within the 1.0s serial timeout window |
| **Energy Potential** | Projected **40–60% reduction** in lighting runtime vs manual baseline in a typical 8-hour school day at 50% occupancy |
| **System Uptime** | No crashes or memory leaks across multi-hour continuous operation sessions |

---

## Getting Started

### Prerequisites

```bash
pip install ultralytics opencv-python pyserial flask pymongo
```

### Configuration

All parameters are centrally managed in the `Config` dataclass — no magic numbers scattered through the code:

```python
@dataclass
class Config:
    camera_index: int = 0
    resolution: tuple = (640, 480)
    model_name: str = "yolov8n.pt"
    confidence_threshold: float = 0.60
    on_delay: float = 3.0       # seconds before relay activates
    off_delay: float = 7.0      # seconds before relay deactivates
    confirm_frames: int = 3     # consecutive frames required for detection
    baud_rate: int = 115200
```

### ESP32 Firmware

Flash the `SmartVision ESP32 Relay Firmware` Arduino sketch to your ESP32. The firmware auto-initialises all relay pins to the safe OFF state (`HIGH`) on boot.

### Run

```bash
python smartvision.py
```

The system will auto-detect your ESP32's serial port, load the YOLOv8n model, open the camera feed, and begin autonomous zone-level lighting control.

---


**WatchWatt — Academic / Innovation Project · April 2026**
