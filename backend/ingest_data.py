"""Upload and ingest all PDFs from ../data via the admin API."""
import asyncio
import sys
from pathlib import Path

# Force UTF-8 output on Windows to handle Spanish filenames
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import httpx

BASE_URL = "http://localhost:8000"
DATA_DIR = Path(__file__).parent.parent / "data"
BATCH_SIZE = 5  # files per request to avoid timeouts
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "davas1410"


async def get_token(client: httpx.AsyncClient) -> str:
    r = await client.post(
        f"{BASE_URL}/auth/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
    )
    r.raise_for_status()
    return r.json()["access_token"]


async def upload_batch(
    client: httpx.AsyncClient, token: str, files: list[Path]
) -> dict:
    multipart = [
        ("files", (f.name, f.read_bytes(), "application/pdf")) for f in files
    ]
    r = await client.post(
        f"{BASE_URL}/admin/upload",
        files=multipart,
        headers={"Authorization": f"Bearer {token}"},
        timeout=600,
    )
    r.raise_for_status()
    return r.json()


async def main() -> None:
    pdfs = sorted(DATA_DIR.rglob("*.pdf"))
    if not pdfs:
        print(f"No PDFs found in {DATA_DIR}")
        sys.exit(1)

    print(f"Found {len(pdfs)} PDFs in {DATA_DIR} (including subdirectories)")

    async with httpx.AsyncClient() as client:
        token = await get_token(client)
        print("Autenticado como admin.\n")

        total_ingested = 0
        total_skipped = 0
        total_errors = 0

        for i in range(0, len(pdfs), BATCH_SIZE):
            batch = pdfs[i : i + BATCH_SIZE]
            batch_num = i // BATCH_SIZE + 1
            total_batches = (len(pdfs) + BATCH_SIZE - 1) // BATCH_SIZE
            names = ", ".join(f.name[:40] for f in batch)
            print(f"[{batch_num}/{total_batches}] Subiendo {len(batch)} archivo(s): {names}…")

            try:
                result = await upload_batch(client, token, batch)
                for r in result.get("results", []):
                    status = r.get("status", "?")
                    fname = r.get("filename", "?")[:55]
                    if status == "ingested":
                        total_ingested += 1
                        print(f"  ✓ {fname}")
                    elif status == "skipped":
                        total_skipped += 1
                        print(f"  ↷ {fname} (ya existe)")
                    else:
                        total_errors += 1
                        print(f"  ✗ {fname}: {r.get('detail', status)}")
            except httpx.HTTPStatusError as exc:
                print(f"  ERROR HTTP {exc.response.status_code}: {exc.response.text[:200]}")
                total_errors += len(batch)
            except Exception as exc:
                print(f"  ERROR: {exc}")
                total_errors += len(batch)

        print(f"\n{'='*60}")
        print(f"Ingesta completada:")
        print(f"  Procesados : {total_ingested}")
        print(f"  Omitidos   : {total_skipped}")
        print(f"  Errores    : {total_errors}")
        print(f"  Total      : {len(pdfs)}")


if __name__ == "__main__":
    asyncio.run(main())
