"""PDF rendering (WeasyPrint) and its checks.

``check_pdf`` is run on every generated PDF; a failure is a critical document issue:
* every font is embedded, and the Arabic text is set in the expected Arabic fonts (a fallback to
  a font without Arabic would show boxes);
* the text drawn on the pages contains the source text's words (shaping or bidi errors that
  scramble letters fail this), checked on the extracted text, which is in visual or logical order
  depending on the line;
* the pages render to non-blank images (pypdfium2), which are kept for visual inspection.
"""

from __future__ import annotations

import io
import logging
from collections import Counter
from pathlib import Path

from pypdf import PdfReader

from mahdar.pipeline import arabic

EXPECTED_FONTS = ("NotoNaskhArabic", "NotoKufiArabic", "Amiri", "NotoSans")


def _fetcher():
    """The documents embed everything they need (the logo as a data: URL); nothing else is
    fetched, so text from a recording or a setting can never make the worker read a local file or
    call a server (WeasyPrint's own protocol allow-list)."""
    from weasyprint.urls import URLFetcher

    return URLFetcher(allowed_protocols={"data"}, allow_redirects=False, timeout=5)


def _data_only(url: str):
    return _fetcher().fetch(url)


def render_pdf(html: str) -> bytes:
    from weasyprint import HTML

    logging.getLogger("weasyprint").setLevel(logging.ERROR)
    logging.getLogger("fontTools").setLevel(logging.ERROR)
    return HTML(string=html, url_fetcher=_fetcher()).write_pdf()


def pdf_fonts(data: bytes) -> list[dict]:
    reader = PdfReader(io.BytesIO(data))
    seen: dict[str, dict] = {}
    for page in reader.pages:
        res = page.get("/Resources") or {}
        fonts = res.get("/Font") or {}
        for ref in fonts.values():
            f = ref.get_object()
            name = str(f.get("/BaseFont", "?"))
            desc = f.get("/FontDescriptor")
            if desc is None and "/DescendantFonts" in f:
                desc = f["/DescendantFonts"][0].get_object().get("/FontDescriptor")
            desc = desc.get_object() if desc is not None else {}
            embedded = any(k in desc for k in ("/FontFile", "/FontFile2", "/FontFile3"))
            seen[name] = {"name": name, "embedded": embedded}
    return list(seen.values())


def extracted_text(data: bytes) -> str:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    try:
        return "\n".join(pdf[i].get_textpage().get_text_range() for i in range(len(pdf)))
    finally:
        pdf.close()


def render_pages(data: bytes, out_dir: Path, scale: float = 1.4) -> list[Path]:
    import pypdfium2 as pdfium

    out_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(data)
    paths = []
    try:
        for i in range(len(pdf)):
            img = pdf[i].render(scale=scale).to_pil()
            p = out_dir / f"page-{i + 1:02d}.png"
            img.save(p)
            paths.append(p)
    finally:
        pdf.close()
    return paths


def _blank(path: Path) -> bool:
    from PIL import Image

    with Image.open(path) as im:
        lo, hi = im.convert("L").getextrema()
    return hi - lo < 10


def check_pdf(data: bytes, source_texts: list[str], *, render_dir: Path | None = None) -> dict:
    problems: list[str] = []
    fonts = pdf_fonts(data)
    not_embedded = [f["name"] for f in fonts if not f["embedded"]]
    if not_embedded:
        problems.append("fonts not embedded: " + ", ".join(not_embedded))
    unexpected = [
        f["name"] for f in fonts if not any(e in f["name"].replace(" ", "").replace("-", "") for e in EXPECTED_FONTS)
    ]
    if unexpected:
        problems.append("unexpected (fallback) fonts: " + ", ".join(unexpected))
    if not any("Arabic" in f["name"] or "Amiri" in f["name"] for f in fonts):
        problems.append("no Arabic font used")
    words = Counter(w for t in source_texts for w in arabic.normalize(t).split() if len(w) >= 3 and not w.isdigit())
    text = extracted_text(data)
    found = set()
    for w in arabic.normalize(text).split():
        found.add(w)
        found.add(w[::-1])
    total = sum(words.values()) or 1
    hit = sum(c for w, c in words.items() if w in found)
    coverage = hit / total
    if coverage < 0.9:
        problems.append(f"only {coverage:.0%} of the source words are found in the PDF text")
    pages = []
    if render_dir is not None:
        pages = render_pages(data, render_dir)
        blank = [p.name for p in pages if _blank(p)]
        if blank:
            problems.append("blank pages: " + ", ".join(blank))
    return {
        "ok": not problems,
        "problems": problems,
        "fonts": fonts,
        "word_coverage": round(coverage, 4),
        "pages": len(PdfReader(io.BytesIO(data)).pages),
        "page_images": [str(p) for p in pages],
    }
