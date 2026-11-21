"""Draws the app icon and splash mark (the Music Seerr eye: dark iris inside rings of light).

Usage: python3 scripts/make-icons.py  (needs Pillow)
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ACCENT = (249, 76, 132)
ACCENT2 = (178, 58, 252)
BG = (9, 9, 13)
OUT = Path(__file__).resolve().parent.parent / "assets"
S = 1024


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def mark(size, background):
    scale = 4
    w = size * scale
    img = Image.new("RGBA", (w, w), background + (255,) if background else (0, 0, 0, 0))
    c = w / 2
    # Soft accent glow behind the eye.
    glow = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = w * 0.36
    gd.ellipse((c - r, c - r, c + r, c + r), fill=ACCENT + (110,))
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.09))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    # Rings: gradient from accent to accent2, thinner and fainter outward.
    rings = [(0.30, 0.022, 255), (0.355, 0.012, 170), (0.40, 0.007, 100)]
    for radius, width, alpha in rings:
        rr = w * radius
        lw = max(2, int(w * width))
        steps = 360
        for i in range(steps):
            a0 = 2 * math.pi * i / steps
            a1 = 2 * math.pi * (i + 1.5) / steps
            t = (math.sin(a0 - 0.8) + 1) / 2
            col = mix(ACCENT, ACCENT2, t) + (alpha,)
            d.line(
                [(c + rr * math.cos(a0), c + rr * math.sin(a0)), (c + rr * math.cos(a1), c + rr * math.sin(a1))],
                fill=col,
                width=lw,
            )
    # Iris.
    ir = w * 0.225
    iris = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    idr = ImageDraw.Draw(iris)
    for k in range(60, 0, -1):
        rk = ir * k / 60
        t = k / 60
        col = mix((12, 10, 18), (46, 24, 52), t ** 2)
        idr.ellipse((c - rk, c - rk, c + rk, c + rk), fill=col + (255,))
    img.alpha_composite(iris)
    # Two highlights.
    for dx, dy, hr, a in [(-0.08, -0.085, 0.052, 235), (0.065, 0.06, 0.022, 180)]:
        hx, hy, h = c + w * dx, c + w * dy, w * hr
        d.ellipse((hx - h, hy - h, hx + h, hy + h), fill=(255, 255, 255, a))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
mark(S, BG).convert("RGB").save(OUT / "icon.png")
mark(S, None).save(OUT / "splash-icon.png")
print("wrote", OUT / "icon.png", OUT / "splash-icon.png")
