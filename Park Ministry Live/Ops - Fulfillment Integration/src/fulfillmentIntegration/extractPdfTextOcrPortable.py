import json
import subprocess
import sys
import tempfile
from pathlib import Path


def command_exists(command: str) -> bool:
    try:
        subprocess.run(
            [command, "-h"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return True
    except FileNotFoundError:
        return False


def render_pdf_to_images(pdf_path: Path, output_dir: Path) -> list[Path]:
    base = output_dir / "page"
    commands = []

    if command_exists("pdftoppm"):
        commands.append(["pdftoppm", "-png", "-r", "300", str(pdf_path), str(base)])
    if command_exists("pdftocairo"):
        commands.append(["pdftocairo", "-png", "-r", "300", str(pdf_path), str(base)])

    last_error = None
    for command in commands:
        try:
            subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
            )
            images = sorted(output_dir.glob("page*.png"))
            if images:
                return images
        except subprocess.CalledProcessError as exc:
            last_error = exc.stderr.strip() or str(exc)

    raise RuntimeError(last_error or "pdf_render_unavailable")


def preprocess_image(image_path: Path) -> Path:
    try:
        from PIL import Image, ImageFilter, ImageOps  # type: ignore
    except Exception:
        return image_path

    image = Image.open(image_path)
    image = ImageOps.grayscale(image)
    image = ImageOps.autocontrast(image)
    image = image.resize((image.width * 2, image.height * 2))
    image = image.filter(ImageFilter.SHARPEN)
    processed_path = image_path.with_name(f"{image_path.stem}-processed.png")
    image.save(processed_path)
    return processed_path


def ocr_with_paddle(image_paths: list[Path]) -> dict:
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"paddle_unavailable:{exc}") from exc

    ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    pages = []

    for index, image_path in enumerate(image_paths):
        result = ocr.ocr(str(image_path), cls=True) or []
        lines = []

        for page_result in result:
            for line in page_result or []:
                if isinstance(line, list) and len(line) >= 2 and isinstance(line[1], (list, tuple)):
                    text = str(line[1][0] or "").strip()
                    if text:
                        lines.append(text)

        pages.append(
            {
                "page_number": index + 1,
                "text": "\n".join(lines).strip(),
            }
        )

    return {
        "engine": "paddleocr",
        "pages": pages,
        "text": "\n".join(page["text"] for page in pages if page["text"]).strip(),
    }


def ocr_with_tesseract(image_paths: list[Path]) -> dict:
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"tesseract_unavailable:{exc}") from exc

    pages = []

    for index, image_path in enumerate(image_paths):
        text = pytesseract.image_to_string(Image.open(image_path), lang="eng")
        pages.append(
            {
                "page_number": index + 1,
                "text": str(text or "").strip(),
            }
        )

    return {
        "engine": "tesseract",
        "pages": pages,
        "text": "\n".join(page["text"] for page in pages if page["text"]).strip(),
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing_pdf_path"}))
        return 1

    pdf_path = Path(sys.argv[1]).resolve()
    if not pdf_path.exists():
        print(json.dumps({"ok": False, "error": "pdf_not_found", "path": str(pdf_path)}))
        return 1

    try:
        with tempfile.TemporaryDirectory(prefix="pm-fulfillment-ocr-") as temp_dir:
            temp_path = Path(temp_dir)
            rendered_images = render_pdf_to_images(pdf_path, temp_path)
            processed_images = [preprocess_image(image_path) for image_path in rendered_images]

            try:
                payload = ocr_with_paddle(processed_images)
            except Exception as paddle_error:
                try:
                    payload = ocr_with_tesseract(processed_images)
                except Exception as tesseract_error:
                    raise RuntimeError(
                        f"ocr_engine_unavailable:paddle={paddle_error};tesseract={tesseract_error}"
                    ) from tesseract_error

        print(
            json.dumps(
                {
                    "ok": True,
                    "path": str(pdf_path),
                    "engine": payload["engine"],
                    "page_count": len(payload["pages"]),
                    "text": payload["text"],
                    "pages": payload["pages"],
                }
            )
        )
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "pdf_portable_ocr_failed",
                    "message": str(exc),
                    "path": str(pdf_path),
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
