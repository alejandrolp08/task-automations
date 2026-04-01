import json
import os
import sys
import io
import contextlib

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR


with contextlib.redirect_stdout(io.StringIO()):
    ocr = PaddleOCR(lang="en")


def build_text_entries(raw_result):
    texts = raw_result.get("rec_texts") if raw_result.get("rec_texts") is not None else []
    scores = raw_result.get("rec_scores") if raw_result.get("rec_scores") is not None else []
    boxes = raw_result.get("rec_boxes") if raw_result.get("rec_boxes") is not None else []
    entries = []

    min_top = None
    max_bottom = 1
    for box in boxes:
      try:
        values = box.tolist() if hasattr(box, "tolist") else box
        if values and len(values) >= 4:
            min_top = values[1] if min_top is None else min(min_top, int(values[1]))
            max_bottom = max(max_bottom, int(values[3]))
      except Exception:
        continue

    text_height = max(1, max_bottom - (min_top or 0))

    for index, text in enumerate(texts):
        if not isinstance(text, str) or not text.strip():
            continue

        score = float(scores[index]) if index < len(scores) else 0.0
        box = boxes[index].tolist() if index < len(boxes) and hasattr(boxes[index], "tolist") else []

        if box and len(box) >= 4:
            top = box[1]
            bottom = box[3]
            center_y = (top + bottom) / 2
            y_ratio = (center_y - (min_top or 0)) / text_height
        else:
            y_ratio = 0.5

        entries.append(
            {
                "text": text.strip(),
                "score": score,
                "y_ratio": round(float(y_ratio), 4),
            }
        )

    return entries


def main():
    image_paths = sys.argv[1:]

    if not image_paths:
        print("[]")
        return

    with contextlib.redirect_stdout(io.StringIO()):
        predictions = ocr.predict(image_paths)
    results = []

    for image_path, raw_result in zip(image_paths, predictions):
        results.append(
            {
                "imagePath": image_path,
                "entries": build_text_entries(raw_result),
            }
        )

    print(json.dumps(results, ensure_ascii=True))


if __name__ == "__main__":
    main()
