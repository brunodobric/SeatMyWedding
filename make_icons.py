"""Generate the PWA PNG icons: a white round decorated banquet table seen from
above (gold rim, place settings and chairs around it, a floral centerpiece) on a
soft cream rounded background, no border. Kept visually in sync with
icons/icon.svg."""
from PIL import Image, ImageDraw
import math
import os

OUT = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(OUT, "icons")
os.makedirs(ICONS, exist_ok=True)

GOLD = (201, 162, 75, 255)
BG_TOP = (253, 251, 247)
BG_BOT = (245, 235, 221)
WHITE = (255, 255, 255, 255)
FAINT = (232, 223, 201, 255)

SEATS = [0, 45, 90, 135, 180, 225, 270, 315]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_bg(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        grad.putpixel((0, y), lerp(BG_TOP, BG_BOT, y / max(1, size - 1)))
    grad = grad.resize((size, size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.167), fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def draw_flower(d, cx, cy, R):
    petal_r = R * 0.42
    dist = R * 0.5
    edge = max(1, int(R * 0.05))
    for k in range(5):
        a = math.radians(k * 72 - 90)
        px = cx + dist * math.cos(a)
        py = cy + dist * math.sin(a)
        d.ellipse([px - petal_r, py - petal_r, px + petal_r, py + petal_r],
                  fill=WHITE, outline=FAINT, width=edge)
    cr = R * 0.3
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=GOLD)


def draw_chair(img, cx, cy, u, ang):
    # Chair drawn facing "up" (outward before rotation), then rotated to face
    # the table centre. u = size / 192 scale unit.
    pad = int(20 * u)
    tmp = Image.new("RGBA", (pad * 2, pad * 2), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    c = pad
    td.rounded_rectangle([c - 9 * u, c - 13.5 * u, c + 9 * u, c - 7.5 * u],
                         radius=3 * u, fill=GOLD)
    td.rounded_rectangle([c - 8 * u, c - 9 * u, c + 8 * u, c + 4 * u],
                         radius=3.5 * u, fill=GOLD)
    tmp = tmp.rotate(-(ang + 90), resample=Image.BICUBIC, center=(c, c))
    img.alpha_composite(tmp, (int(cx - pad), int(cy - pad)))


def draw_plate(d, cx, cy, u):
    r = 7 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE, outline=GOLD,
              width=max(1, int(1.4 * u)))
    ri = 3 * u
    d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], outline=FAINT,
              width=max(1, int(0.8 * u)))


def make_icon(size):
    img = rounded_bg(size)
    u = size / 192.0
    cx = cy = size * 0.5

    # Chairs around the table
    for ang in SEATS:
        a = math.radians(ang)
        draw_chair(img, cx + 62 * u * math.cos(a), cy + 62 * u * math.sin(a),
                   u, ang)

    d = ImageDraw.Draw(img)
    # Table top
    tr = 44 * u
    d.ellipse([cx - tr, cy - tr, cx + tr, cy + tr], fill=WHITE, outline=GOLD,
              width=max(2, int(3 * u)))
    ir = 39 * u
    d.ellipse([cx - ir, cy - ir, cx + ir, cy + ir], outline=FAINT,
              width=max(1, int(u)))

    # Place settings
    for ang in SEATS:
        a = math.radians(ang)
        draw_plate(d, cx + 30 * u * math.cos(a), cy + 30 * u * math.sin(a), u)

    # Floral centerpiece
    draw_flower(d, cx, cy, 12 * u)
    return img


for s in (192, 512):
    make_icon(s).save(os.path.join(ICONS, f"icon-{s}.png"))
    print("wrote", f"icon-{s}.png")

# Maskable variant: pad so nothing is clipped by the safe-zone circle.
for s in (192, 512):
    base = make_icon(s)
    pad = int(s * 0.1)
    canvas = Image.new("RGBA", (s, s), (245, 235, 221, 255))
    inner = base.resize((s - 2 * pad, s - 2 * pad))
    canvas.paste(inner, (pad, pad), inner)
    canvas.save(os.path.join(ICONS, f"icon-{s}-maskable.png"))
    print("wrote", f"icon-{s}-maskable.png")
