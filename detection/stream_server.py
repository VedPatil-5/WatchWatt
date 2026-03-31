"""
Flask Detection Stream Server
Streams YOLO detection feed over MJPEG and exposes /status endpoint.
Run this alongside the Node.js backend.
"""

import cv2
import time
import threading
import logging
from flask import Flask, Response, jsonify
from flask_cors import CORS
from ultralytics import YOLO
import numpy as np

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
log = logging.getLogger("StreamServer")

app = Flask(__name__)
CORS(app)

# ── Config ────────────────────────────────────────────────────────
CAMERA_INDEX  = 0
FRAME_WIDTH   = 640
FRAME_HEIGHT  = 480
CONFIDENCE    = 0.60
YOLO_MODEL    = "yolov8n.pt"
WIDTH_THRESHOLDS = (0.48, 0.25, 0.17)
ZONE_LABELS      = ("BENCH 1", "BENCH 2", "BENCH 3", "BENCH 4")

# ── Shared State ──────────────────────────────────────────────────
state = {
    "online":     False,
    "people":     0,
    "lights_on":  0,
    "last_frame": None,
    "lock":       threading.Lock(),
}

# ── Palette (BGR) ─────────────────────────────────────────────────
GREEN  = (0, 220, 90)
RED    = (0, 60, 220)
YELLOW = (0, 220, 220)
WHITE  = (240, 240, 240)
DARK   = (20, 20, 20)
CYAN   = (220, 220, 0)

def classify_zone(box_width_ratio):
    if   box_width_ratio > WIDTH_THRESHOLDS[0]: return ZONE_LABELS[0]
    elif box_width_ratio > WIDTH_THRESHOLDS[1]: return ZONE_LABELS[1]
    elif box_width_ratio > WIDTH_THRESHOLDS[2]: return ZONE_LABELS[2]
    else:                                        return ZONE_LABELS[3]

def get_side(cx, fw):
    return "LEFT" if cx < fw / 2 else "RIGHT"

def draw_overlay(frame, detections, fps):
    fh, fw = frame.shape[:2]
    panel_w = 200

    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (panel_w, 175), DARK, -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)

    def put(text, y, color=WHITE, scale=0.58):
        cv2.putText(frame, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)

    online_color = GREEN if state["online"] else RED
    put(f"SYSTEM : {'ONLINE' if state['online'] else 'OFFLINE'}", 22, online_color, 0.60)
    put(f"PEOPLE : {len(detections)}", 48, YELLOW, 0.60)
    put(f"ACTIVE : {state['lights_on']} lights", 74, CYAN, 0.58)
    put(f"FPS    : {fps:.1f}", 100, (130, 130, 130), 0.50)

    ts = time.strftime("%H:%M:%S")
    put(f"TIME   : {ts}", 126, (130, 130, 130), 0.50)

    for det in detections:
        x1, y1, x2, y2, conf, zone, side = det
        cv2.rectangle(frame, (x1, y1), (x2, y2), GREEN, 2)
        label = f"{zone} | {side}  {conf:.0%}"
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)
        cy = y1 - 6
        cv2.rectangle(frame, (x1, cy - lh - 4), (x1 + lw + 6, cy + 2), DARK, -1)
        cv2.putText(frame, label, (x1 + 3, cy - 1), cv2.FONT_HERSHEY_SIMPLEX, 0.50, WHITE, 1, cv2.LINE_AA)

    # SmartVision watermark
    wm = "SmartVision LIVE"
    (ww, _), _ = cv2.getTextSize(wm, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
    cv2.putText(frame, wm, (fw - ww - 8, fh - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (60, 200, 60), 1, cv2.LINE_AA)

    return frame

def detection_worker():
    """Background thread: capture → detect → store latest JPEG."""
    log.info("Loading YOLO model …")
    try:
        model = YOLO(YOLO_MODEL)
        log.info("YOLO model loaded ✅")
    except Exception as e:
        log.error(f"YOLO load failed: {e}")
        return

    log.info(f"Opening camera {CAMERA_INDEX} …")
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        log.error("Camera not available — serving placeholder frames")
        # Serve a placeholder frame
        while True:
            placeholder = np.zeros((FRAME_HEIGHT, FRAME_WIDTH, 3), dtype=np.uint8)
            cv2.putText(placeholder, "Camera Offline", (170, 230),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, RED, 2, cv2.LINE_AA)
            cv2.putText(placeholder, "Check camera connection", (130, 270),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, WHITE, 1, cv2.LINE_AA)
            _, buf = cv2.imencode('.jpg', placeholder, [cv2.IMWRITE_JPEG_QUALITY, 80])
            with state["lock"]:
                state["last_frame"] = buf.tobytes()
                state["online"]     = False
            time.sleep(1)
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    state["online"] = True

    times = []
    log.info("Detection loop started ✅")

    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(0.03)
            continue

        frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT))
        fh, fw = frame.shape[:2]

        # FPS
        now = time.time()
        times.append(now)
        if len(times) > 30: times.pop(0)
        fps = (len(times) - 1) / (times[-1] - times[0]) if len(times) > 1 else 0.0

        # YOLO
        results = model(frame, verbose=False, classes=[0], conf=CONFIDENCE)
        detections = []
        for r in results:
            for box in r.boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf            = float(box.conf[0])
                bw_ratio        = (x2 - x1) / fw
                cx              = (x1 + x2) / 2
                zone            = classify_zone(bw_ratio)
                side            = get_side(cx, fw)
                detections.append((x1, y1, x2, y2, conf, zone, side))

        state["people"]    = len(detections)
        state["lights_on"] = len(set((z, s) for _, _, _, _, _, z, s in detections))

        annotated = draw_overlay(frame.copy(), detections, fps)
        _, buf = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])

        with state["lock"]:
            state["last_frame"] = buf.tobytes()

    cap.release()


def generate_frames():
    """MJPEG generator for the stream endpoint."""
    while True:
        with state["lock"]:
            frame = state["last_frame"]
        if frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.033)   # ~30 fps cap


@app.route('/detection_feed')
def detection_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@app.route('/status')
def status():
    return jsonify({
        "online":    state["online"],
        "people":    state["people"],
        "lights_on": state["lights_on"],
        "timestamp": time.time(),
    })


@app.route('/snapshot')
def snapshot():
    with state["lock"]:
        frame = state["last_frame"]
    if not frame:
        return "No frame", 503
    return Response(frame, mimetype='image/jpeg')


if __name__ == '__main__':
    worker = threading.Thread(target=detection_worker, daemon=True)
    worker.start()
    log.info("Flask stream server starting on port 5000 …")
    app.run(host='0.0.0.0', port=5000, threaded=True)
