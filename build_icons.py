#!/usr/bin/env python3
"""build_icons.py — the PNG app icons an installed web app needs.

The site's own mark is `assets/flag-palestine.svg`, which is all a browser tab
needs. An installed application is asked for raster icons at fixed sizes, and
for a maskable one that a launcher may crop to a circle or a squircle, so the
flag is drawn here rather than converted: the geometry is four rectangles and a
triangle, and drawing it avoids a rasteriser dependency.

    python3 build_icons.py

Writes assets/icon-192.png, assets/icon-512.png and assets/icon-maskable-512.png.
Only needs running again if the palette or the shape changes.
"""

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent
ASSETS = ROOT / 'assets'

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 122, 61)
RED = (206, 17, 18)
PLATE = (5, 7, 12)


def flag(draw, x, y, w, h):
    """The flag itself: three bands and the hoist triangle over them."""
    band = h / 3
    draw.rectangle([x, y, x + w, y + band], fill=BLACK)
    draw.rectangle([x, y + band, x + w, y + 2 * band], fill=WHITE)
    draw.rectangle([x, y + 2 * band, x + w, y + h], fill=GREEN)
    draw.polygon([(x, y), (x + w * 0.42, y + h / 2), (x, y + h)], fill=RED)


def square(size, inset):
    """A square icon: the flag centred on the site's own background.

    `inset` is the share of the square left as margin on each side. A launcher
    icon is cropped, sometimes to a circle, so the flag is kept well inside the
    edge rather than bled to it.
    """
    img = Image.new('RGB', (size, size), PLATE)
    draw = ImageDraw.Draw(img)
    w = size * (1 - 2 * inset)
    h = w * 2 / 3
    flag(draw, (size - w) / 2, (size - h) / 2, w, h)
    return img


def main():
    ASSETS.mkdir(exist_ok=True)
    written = [
        ('icon-192.png', square(192, 0.10)),
        ('icon-512.png', square(512, 0.10)),
        # The maskable icon is cropped by the launcher, so its content sits
        # inside the central 80% the specification guarantees will survive.
        ('icon-maskable-512.png', square(512, 0.22)),
    ]
    for name, img in written:
        img.save(ASSETS / name, optimize=True)
        print('wrote assets/%s (%d×%d)' % (name, img.width, img.height))


if __name__ == '__main__':
    main()
