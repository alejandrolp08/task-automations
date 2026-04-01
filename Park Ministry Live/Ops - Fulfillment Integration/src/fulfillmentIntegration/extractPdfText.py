import json
import sys
from pathlib import Path


VENDOR_PATH = Path(__file__).resolve().parents[2] / "vendor" / "python"
if str(VENDOR_PATH) not in sys.path:
    sys.path.insert(0, str(VENDOR_PATH))

from pypdf import PdfReader  # type: ignore


def main() -> int:
    if len(sys.argv) < 2:
      print(json.dumps({"ok": False, "error": "missing_pdf_path"}))
      return 1

    pdf_path = Path(sys.argv[1]).resolve()

    if not pdf_path.exists():
      print(json.dumps({"ok": False, "error": "pdf_not_found", "path": str(pdf_path)}))
      return 1

    try:
      reader = PdfReader(str(pdf_path))
      pages = []

      for index, page in enumerate(reader.pages):
        page_text = page.extract_text() or ""
        pages.append(
          {
            "page_number": index + 1,
            "text": page_text,
          }
        )

      full_text = "\n".join(page["text"] for page in pages).strip()
      payload = {
        "ok": True,
        "path": str(pdf_path),
        "page_count": len(pages),
        "text": full_text,
        "pages": pages,
      }
      print(json.dumps(payload))
      return 0
    except Exception as exc:
      print(
        json.dumps(
          {
            "ok": False,
            "error": "pdf_extract_failed",
            "message": str(exc),
            "path": str(pdf_path),
          }
        )
      )
      return 1


if __name__ == "__main__":
    raise SystemExit(main())
