import io
import logging

import cv2
import numpy as np
import pymupdf
import pytesseract
from PIL import Image

logger = logging.getLogger(__name__)

MIN_CHARS = 50


def _preprocess_image(pix: pymupdf.Pixmap) -> np.ndarray:
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2RGB)
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(binary < 255))
    if len(coords) > 0:
        _, _, angle = cv2.minAreaRect(coords)
        if abs(angle) > 0.5:
            h, w = binary.shape
            M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1)
            binary = cv2.warpAffine(binary, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)
    denoised = cv2.fastNlMeansDenoising(binary, h=10)
    return denoised


def extract_text(file_bytes: bytes) -> list[str]:
    """Return one text string per PDF page (empty strings for unreadable pages)."""
    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    pages: list[str] = []
    try:
        for page in doc:
            try:
                text = page.get_text().strip()
                if len(text) >= MIN_CHARS:
                    pages.append(text)
                    continue

                pix = page.get_pixmap(dpi=300)
                processed = _preprocess_image(pix)
                pil_img = Image.fromarray(processed)
                ocr_text = pytesseract.image_to_string(pil_img, lang="spa", config="--psm 6")
                pages.append(ocr_text.strip())
            except Exception as e:
                logger.warning(f"Error procesando página {page.number}: {e}")
                pages.append("")
    finally:
        doc.close()
    return pages
