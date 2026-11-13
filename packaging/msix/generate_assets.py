"""Resize the existing ReupAI mark into MSIX and Store listing assets."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with Image.open(args.source) as opened:
        logo = opened.convert("RGBA")
    for name, size in {
        "Square44x44Logo.png": 44,
        "Square150x150Logo.png": 150,
        "StoreLogo.png": 50,
        "StoreListingLogo.png": 300,
    }.items():
        ImageOps.contain(logo, (size, size), Image.Resampling.LANCZOS).save(args.output / name)


if __name__ == "__main__":
    main()
