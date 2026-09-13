"""
Generate the Cortex extension icons: a purple rounded square with a white
four-pointed star (the ✦ glyph), at 16, 48 and 128 px.

Uses ONLY the Python standard library (no Pillow needed), so it runs anywhere:

    python extension/icons/generate_icons.py

To restyle: change PURPLE / WHITE / the proportions below and re-run.
"""

import struct
import zlib
from pathlib import Path

PURPLE = (109, 40, 217)   # #6d28d9 — same accent as sidebar.css
WHITE = (255, 255, 255)
SIZES = (16, 48, 128)
SUPERSAMPLE = 4           # sub-pixels per axis, for smooth (anti-aliased) edges

CORNER_RADIUS = 0.22      # rounded-corner radius, as a fraction of icon size
STAR_RADIUS = 0.36        # star tip distance from center, as a fraction of size
STAR_SHARPNESS = 0.55     # <1 makes concave "✦" sides; smaller = thinner points

OUT_DIR = Path(__file__).resolve().parent


def in_rounded_square(x, y, size):
    """Is point (x, y) inside a size x size square with rounded corners?"""
    r = CORNER_RADIUS * size
    dx = max(r - x, 0.0, x - (size - r))
    dy = max(r - y, 0.0, y - (size - r))
    return dx * dx + dy * dy <= r * r


def in_star(x, y, size):
    """Four-pointed star: |x|^p + |y|^p <= R^p with p < 1 gives curved, pointy sides."""
    c = size / 2
    R = STAR_RADIUS * size
    p = STAR_SHARPNESS
    return abs(x - c) ** p + abs(y - c) ** p <= R ** p


def render(size):
    """Return raw RGBA bytes for one icon."""
    n = SUPERSAMPLE
    total = n * n
    pixels = bytearray()
    for py in range(size):
        for px in range(size):
            r_sum = g_sum = b_sum = covered = 0
            for sy in range(n):
                for sx in range(n):
                    x = px + (sx + 0.5) / n
                    y = py + (sy + 0.5) / n
                    if not in_rounded_square(x, y, size):
                        continue
                    color = WHITE if in_star(x, y, size) else PURPLE
                    r_sum += color[0]
                    g_sum += color[1]
                    b_sum += color[2]
                    covered += 1
            if covered:
                pixels += bytes((r_sum // covered, g_sum // covered, b_sum // covered,
                                 round(255 * covered / total)))
            else:
                pixels += b"\x00\x00\x00\x00"
    return bytes(pixels)


def write_png(path, size, rgba):
    """Minimal PNG encoder: signature + IHDR + IDAT (zlib) + IEND."""
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    stride = size * 4
    # Each scanline starts with filter byte 0 ("None").
    raw = b"".join(b"\x00" + rgba[y * stride:(y + 1) * stride] for y in range(size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                     + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    for size in SIZES:
        out = OUT_DIR / f"icon{size}.png"
        write_png(out, size, render(size))
        print(f"wrote {out.name}")
