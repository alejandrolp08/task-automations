import json
import os
import sys
import io
import contextlib

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from ultralytics import YOLOWorld


PROMPTS = ["trading card", "pokemon card", "card in hand"]


with contextlib.redirect_stdout(io.StringIO()):
    model = YOLOWorld("yolov8s-worldv2.pt")
    model.set_classes(PROMPTS)


def main():
    image_paths = sys.argv[1:]

    if not image_paths:
        print("[]")
        return

    with contextlib.redirect_stdout(io.StringIO()):
        results = model.predict(image_paths, verbose=False, conf=0.05)

    detections = []

    for image_path, result in zip(image_paths, results):
        best = None
        best_score = -1.0
        image_width = 0
        image_height = 0

        if hasattr(result, "orig_shape") and result.orig_shape is not None:
            image_height, image_width = result.orig_shape

        for box in result.boxes:
            confidence = float(box.conf[0]) if box.conf is not None else 0.0
            cls_id = int(box.cls[0]) if box.cls is not None else -1
            xyxy = [float(value) for value in box.xyxy[0].tolist()]
            width = max(1.0, xyxy[2] - xyxy[0])
            height = max(1.0, xyxy[3] - xyxy[1])
            area = width * height
            center_x = (xyxy[0] + xyxy[2]) / 2
            center_y = (xyxy[1] + xyxy[3]) / 2
            normalized_center_x = center_x / max(1.0, image_width)
            normalized_center_y = center_y / max(1.0, image_height)
            center_penalty = abs(normalized_center_x - 0.5) * 1.4 + abs(normalized_center_y - 0.58) * 1.2
            score = confidence * 1000 + area * 0.0012 - center_penalty * 100

            if score > best_score:
                best_score = score
                best = {
                    "imagePath": image_path,
                    "classId": cls_id,
                    "className": PROMPTS[cls_id] if 0 <= cls_id < len(PROMPTS) else "card",
                    "confidence": round(confidence, 4),
                    "x": round(xyxy[0]),
                    "y": round(xyxy[1]),
                    "w": round(width),
                    "h": round(height),
                }

        detections.append(best or {"imagePath": image_path})

    print(json.dumps(detections, ensure_ascii=True))


if __name__ == "__main__":
    main()
