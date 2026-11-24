"""Builds JhemsStream's SITE gameplay borders from SITE's own art (src/bg1.png, src/bg2.png).

The originals give the game a 1772x660 window. These keep the look but give the game a 16:9 window that fills
most of the canvas, with a thin neon frame, a top bar for the scoreboard and the SITE wordmark and logo.
Run: python scripts/borders/make.py  (writes into src-tauri/resources/stingers/, which ships with the app)
Window rectangles here must match TEMPLATES in web/borders.js.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "src-tauri" / "resources" / "stingers"
W, H = 1920, 1080
FONT = "C:/Windows/Fonts/bahnschrift.ttf"

# windows (x, y, w, h); every one of them is fully transparent in the PNG
GAME = (93, 84, 1735, 976)                  # Gameplay and Instant Replay: 16:9, 90% of the canvas
SPLIT_GAME = (40, 84, 1448, 815)            # Gameplay + Chat: 16:9 game on the left
SPLIT_CHAT = (1508, 84, 372, 815)           # chat panel on the right (a dark panel, the chat source sits on it)
CHAT_SLOT = (1516, 130, 356, 761)           # where the chat source goes inside the panel
# Game + Cams: a 16:9 game window with a camera window in each bottom corner (BG1 and BG2 versions)
CG = (256, 78, 1408, 792)
CAM_L = (24, 876, 336, 189)
CAM_R = (1560, 876, 336, 189)
# Casters (BG2): two 16:9 camera windows side by side, a name plate under each
CAST_L = (112, 214, 832, 468)
CAST_R = (976, 214, 832, 468)
PLATE_Y, PLATE_H = 700, 64
NEON = (196, 92, 255)                       # the purple of SITE's grid
NEON_HOT = (255, 120, 230)
CYAN = (90, 220, 255)


def key_white(im, lo=48, hi=175):
    """Lift near-white artwork (wordmark, logo) off the dark background: alpha from the smallest RGB channel,
    so saturated purple grid lines fall away and white or pale-yellow text stays."""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            m = min(r, g, b)
            k = 0 if m <= lo else 255 if m >= hi else int((m - lo) * 255 / (hi - lo))
            px[x, y] = (min(255, r + 25), min(255, g + 25), min(255, b + 25), k * a // 255)
    return im


def backdrop(src):
    """SITE's art with its own window filled in: a dark purple wash under it, so pixels the new layout no longer
    cuts away are never left transparent."""
    base = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(base)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(14 + 10 * t), int(5 + 3 * t), int(30 + 14 * t), 255))
    # faint vertical grid lines in the filled area, matching the tunnel walls (own layer: drawing writes alpha as-is)
    lines = Image.new("RGBA", (W, H))
    dl = ImageDraw.Draw(lines)
    for x in range(0, W, 64):
        dl.line([(x, 0), (x, H)], fill=(70, 30, 120, 70), width=1)
    base.alpha_composite(lines)
    base.alpha_composite(src)
    return base


def cut(im, rect, radius=10):
    x, y, w, h = rect
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius, fill=255)
    a = im.getchannel("A")
    a.paste(0, mask=mask)
    im.putalpha(a)


def glow_frame(im, rect, color=NEON, width=3, radius=10, blur=9, corners=True):
    """A neon line around a window, a soft glow outside it, and brighter corner brackets."""
    x, y, w, h = rect
    layer = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([x - 3, y - 3, x + w + 2, y + h + 2], radius=radius + 3, outline=color + (255,), width=width + 3)
    glow = layer.filter(ImageFilter.GaussianBlur(blur))
    im.alpha_composite(glow); im.alpha_composite(glow)
    line = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(line)
    d.rounded_rectangle([x - 2, y - 2, x + w + 1, y + h + 1], radius=radius + 2, outline=color + (255,), width=width)
    if corners:
        L = 54
        for cx, cy, sx, sy in [(x - 6, y - 6, 1, 1), (x + w + 5, y - 6, -1, 1), (x - 6, y + h + 5, 1, -1), (x + w + 5, y + h + 5, -1, -1)]:
            d.line([(cx, cy), (cx + sx * L, cy)], fill=NEON_HOT + (255,), width=4)
            d.line([(cx, cy), (cx, cy + sy * L)], fill=NEON_HOT + (255,), width=4)
    im.alpha_composite(line)


def shade(im, box, top_alpha=200, bottom_alpha=60):
    """Darken a band so the wordmark and scoreboard read over the grid."""
    x0, y0, x1, y1 = box
    band = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(band)
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0 - 1)
        d.line([(x0, y), (x1, y)], fill=(6, 2, 16, int(top_alpha + (bottom_alpha - top_alpha) * t)))
    im.alpha_composite(band)


def paste_h(im, art, x, y, height, anchor="l"):
    s = art.resize((round(art.width * height / art.height), height), Image.LANCZOS)
    if anchor == "r":
        x -= s.width
    elif anchor == "c":
        x -= s.width // 2
    # a little glow behind, like the original lettering
    g = Image.new("RGBA", (W, H)); g.alpha_composite(s, (x, y))
    im.alpha_composite(g.filter(ImageFilter.GaussianBlur(6)))
    im.alpha_composite(s, (x, y))
    return s.width


def font(size, weight="Bold"):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def badge(im, text, cx, cy):
    """INSTANT REPLAY plate for the replay border's top bar."""
    f = font(44)
    tw = ImageDraw.Draw(im).textlength(text, font=f)
    pw, ph = int(tw + 120), 58
    x0, y0 = int(cx - pw / 2), int(cy - ph / 2)
    plate = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(plate)
    poly = [(x0 + 22, y0), (x0 + pw, y0), (x0 + pw - 22, y0 + ph), (x0, y0 + ph)]
    d.polygon(poly, fill=(40, 8, 70, 235), outline=NEON + (255,))
    im.alpha_composite(plate.filter(ImageFilter.GaussianBlur(10)))
    im.alpha_composite(plate)
    d = ImageDraw.Draw(im)
    # play-twice mark, then the words
    tx = x0 + 70
    for k in range(2):
        ox = x0 + 30 + k * 16
        d.polygon([(ox, cy - 12), (ox + 16, cy), (ox, cy + 12)], fill=NEON_HOT + (255,))
    glow = Image.new("RGBA", (W, H))
    ImageDraw.Draw(glow).text((tx, cy), text, font=f, fill=(255, 240, 170, 255), anchor="lm")
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(5)))
    d.text((tx, cy), text, font=f, fill=(255, 255, 255, 255), anchor="lm")


def check_holes(im, holes, name):
    """Every transparent pixel must sit inside a window, and every window must be fully transparent."""
    a = im.getchannel("A")
    inside = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(inside)
    for x, y, w, h in holes:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=255)
    stray = sum(1 for p, i in zip(a.tobytes(), inside.tobytes()) if p < 250 and not i)
    assert stray == 0, f"{name}: {stray} see-through pixels outside the windows"
    for x, y, w, h in holes:
        c = a.crop((x + 12, y + 12, x + w - 12, y + h - 12))
        assert c.getextrema()[1] == 0, f"{name}: window {x},{y} is not fully transparent"


def main():
    bg1 = Image.open(HERE / "src" / "bg1.png").convert("RGBA")
    wordmark = key_white(bg1.crop((290, 950, 1075, 1062)))
    logo = key_white(bg1.crop((1462, 940, 1825, 1012)))
    base = backdrop(bg1)

    # Gameplay: 90% game window, scoreboard space in the middle of the top bar
    for name, kind in [("border-gameplay.png", "game"), ("border-replay.png", "replay")]:
        im = base.copy()
        shade(im, (0, 0, W, GAME[1]), 215, 140)
        shade(im, (0, GAME[1] + GAME[3], W, H), 120, 200)
        glow_frame(im, GAME)
        paste_h(im, wordmark, 104, 13, 58)
        paste_h(im, logo, 1818, 14, 56, "r")
        if kind == "replay":
            badge(im, "INSTANT REPLAY", W // 2, 42)
        cut(im, GAME)  # last, so no glow spills into the window
        check_holes(im, [GAME], name)
        im.save(OUT / name, optimize=True)
        print("wrote", name)

    # Gameplay + Chat: game left, a chat panel right, the full wordmark and logo along the bottom like the original
    im = base.copy()
    shade(im, (0, 0, W, SPLIT_GAME[1]), 215, 140)
    x, y, w, h = SPLIT_CHAT
    panel = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(panel)
    d.rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=10, fill=(10, 4, 24, 235))
    d.rounded_rectangle([x, y, x + w - 1, y + 40], radius=10, fill=(52, 14, 92, 255))
    d.rectangle([x, y + 30, x + w - 1, y + 40], fill=(52, 14, 92, 255))
    im.alpha_composite(panel)
    d = ImageDraw.Draw(im)
    d.ellipse([x + 16, y + 14, x + 28, y + 26], fill=(255, 64, 96, 255))
    d.text((x + 38, y + 21), "LIVE CHAT", font=font(24), fill=(255, 255, 255, 255), anchor="lm")
    glow_frame(im, SPLIT_GAME)
    glow_frame(im, SPLIT_CHAT, color=NEON, corners=False)
    cut(im, SPLIT_GAME)
    check_holes(im, [SPLIT_GAME], "border-chat.png")
    im.save(OUT / "border-chat.png", optimize=True)
    print("wrote border-chat.png")


def erase(im, boxes):
    """Remove SITE's own lettering from the art so a moved copy doesn't leave a ghost: the letters (found the same way
    key_white finds them, then grown a little) are filled from the surrounding background by normalised blurring."""
    import numpy as np
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    mask = Image.new("L", (W, H), 0)
    for x0, y0, x1, y1 in boxes:
        k = key_white(im.crop((x0, y0, x1, y1)), lo=40).getchannel("A").point(lambda v: 255 if v > 20 else 0)
        mask.paste(k.filter(ImageFilter.MaxFilter(11)), (x0, y0))
    m = np.asarray(mask, dtype=np.float32)[..., None] / 255
    keep = 1 - m
    out = a.copy()
    for r in (6, 18, 48):  # small radius first keeps texture; the larger ones fill what is left
        num = np.asarray(Image.fromarray((a * keep).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float32)
        den = np.asarray(Image.fromarray((keep[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float32)[..., None] / 255
        fill = num / np.maximum(den, 1e-3)
        ok = (den > 0.25) & (m > 0)
        out = np.where(ok, fill, out)
        m = np.where(ok, 0, m)
    res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("RGBA")
    res.putalpha(im.getchannel("A"))
    return res


def frame_layout(im, holes, top=None, bottom=None, logo=None, cams=()):
    """Shade the bars, frame every window, place art, then cut the windows last."""
    shade(im, (0, 0, W, holes[0][1]), 215, 140)
    for h_ in holes:
        glow_frame(im, h_, corners=h_ not in cams)
    if top:
        art, x, y, hh, anchor = top
        paste_h(im, art, x, y, hh, anchor)
    if logo:
        paste_h(im, logo, 1818, 12, 52, "r")
    if bottom:
        art, x, y, hh, anchor = bottom
        paste_h(im, art, x, y, hh, anchor)
    for h_ in holes:
        cut(im, h_)


def more(bg1, bg2):
    """BG2 borders, Game + Cams borders, casters, full-frame bumper backgrounds, wordmark exports."""
    wm1 = key_white(bg1.crop((290, 950, 1075, 1062)))
    logo = key_white(bg1.crop((1462, 940, 1825, 1012)))
    wm2top = key_white(bg2.crop((170, 70, 1180, 165)))
    wm2bot = key_white(bg2.crop((110, 920, 1275, 1010)))
    for art, n in [(wm1, "site-wordmark.png"), (logo, "site-logo.png"), (wm2top, "site-title.png"), (wm2bot, "site-esports.png")]:
        art.save(OUT / n, optimize=True)
    b1 = erase(backdrop(bg1), [(290, 950, 1075, 1062), (1462, 940, 1825, 1012)])
    b2 = erase(backdrop(bg2), [(170, 70, 1180, 165), (110, 920, 1275, 1010), (1490, 955, 1865, 1040)])

    # BG2 "Arena": the same 90% game window as SITE Gameplay, in BG2's neon corridor art
    im = b2.copy()
    shade(im, (0, GAME[1] + GAME[3], W, H), 120, 200)
    frame_layout(im, [GAME], top=(wm2top, 104, 25, 34, "l"), logo=logo)
    check_holes(im, [GAME], "border-arena.png"); im.save(OUT / "border-arena.png", optimize=True)

    # Game + Cams, BG1 and BG2
    for name, base, art in [("border-cams.png", b1, wm1), ("border-arena-cams.png", b2, wm2bot)]:
        im = base.copy()
        shade(im, (CAM_L[0] + CAM_L[2], CG[1] + CG[3], CAM_R[0], H), 90, 200)
        bottom = (art, W // 2, 922, 84 if art is wm1 else 52, "c")
        top = (wm2top, 24, 25, 30, "l") if art is wm2bot else (wm1, 24, 10, 58, "l")
        frame_layout(im, [CG, CAM_L, CAM_R], top=top, logo=logo, bottom=bottom, cams=(CAM_L, CAM_R))
        check_holes(im, [CG, CAM_L, CAM_R], name); im.save(OUT / name, optimize=True)

    # Casters (BG2): two camera windows and name plates
    im = b2.copy()
    shade(im, (0, 0, W, H), 110, 110)
    for x, y, w, h_ in (CAST_L, CAST_R):
        plate = Image.new("RGBA", (W, H)); d = ImageDraw.Draw(plate)
        d.rounded_rectangle([x + 60, PLATE_Y, x + w - 60, PLATE_Y + PLATE_H], radius=8, fill=(30, 8, 58, 240), outline=NEON + (255,), width=2)
        d.polygon([(x + 60, PLATE_Y + PLATE_H - 4), (x + w - 60, PLATE_Y + PLATE_H - 4), (x + w - 60, PLATE_Y + PLATE_H)], fill=NEON_HOT + (255,))
        im.alpha_composite(plate.filter(ImageFilter.GaussianBlur(8))); im.alpha_composite(plate)
    frame_layout(im, [CAST_L, CAST_R], top=(wm2top, W // 2, 70, 70, "c"), bottom=(wm2bot, W // 2, 902, 56, "c"))
    paste_h(im, logo, 1880, 1000, 48, "r")
    check_holes(im, [CAST_L, CAST_R], "border-casters.png"); im.save(OUT / "border-casters.png", optimize=True)

    # full-frame backgrounds for the bumper screens (title cards, matchups, win screens' frame, awards)
    # backgrounds keep SITE's own lettering where it is: nothing moves on them, so nothing to erase
    for name, base in [("bg-site1.jpg", backdrop(bg1)), ("bg-site2.jpg", backdrop(bg2))]:
        im = base.copy()
        v = Image.new("RGBA", (W, H)); d = ImageDraw.Draw(v)
        for i in range(60):
            d.rectangle([i * 8, i * 5, W - i * 8, H - i * 5], outline=(0, 0, 0, 3))
        im.alpha_composite(v)
        im.convert("RGB").save(OUT / name, quality=88)
    print("wrote BG2, cams, casters, backgrounds, wordmarks")


def thumbs():
    """320x180 previews for the Add scene dialog (web/img), the windows shown as labelled grey."""
    dst = HERE.parent.parent / "web" / "img"
    dst.mkdir(exist_ok=True)
    for name, wins in [("gameplay", [(GAME, "GAME")]), ("chat", [(SPLIT_GAME, "GAME"), (CHAT_SLOT, "CHAT")]), ("replay", [(GAME, "REPLAY")]),
                       ("arena", [(GAME, "GAME")]), ("cams", [(CG, "GAME"), (CAM_L, "CAM"), (CAM_R, "CAM")]),
                       ("arena-cams", [(CG, "GAME"), (CAM_L, "CAM"), (CAM_R, "CAM")]), ("casters", [(CAST_L, "CAM"), (CAST_R, "CAM")])]:
        im = Image.new("RGBA", (W, H), (58, 60, 72, 255))
        d = ImageDraw.Draw(im)
        for (x, y, w, h), label in wins:
            d.rectangle([x, y, x + w, y + h], fill=(70, 73, 86, 255))
        im.alpha_composite(Image.open(OUT / f"border-{name}.png"))
        d = ImageDraw.Draw(im)
        for (x, y, w, h), label in wins:
            d.text((x + w / 2, y + h / 2), label, font=font(90 if w > 600 else 60), fill=(205, 208, 220, 255), anchor="mm")
        im.convert("RGB").resize((320, 180), Image.LANCZOS).save(dst / f"tpl-{name}.jpg", quality=86)
        print("wrote", f"tpl-{name}.jpg")


if __name__ == "__main__":
    main()
    more(Image.open(HERE / "src" / "bg1.png").convert("RGBA"), Image.open(HERE / "src" / "bg2.png").convert("RGBA"))
    thumbs()
