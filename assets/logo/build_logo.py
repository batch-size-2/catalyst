"""Builds the Catalyst logos: a hand-constructed monoline wordmark.

Every letter is drawn with the same round-capped pen. The cat lives inside the word:
the c is a line-drawn cat head whose ears grow out of the same stroke, and the y's
descender curls up like a tail. No font is used.

Usage (from the repo root): python3 assets/logo/build_logo.py
"""

from math import cos, radians, sin
from pathlib import Path

HERE = Path(__file__).parent

ORANGE = "#EF7F1A"
INK = "#23262F"
LIGHT = "#FFF4E8"

X = 100.0            # x-height
W = 21.0             # pen width
R = 40.5             # radius of round letters (outer edge overshoots the x-height by 1)
HW = W / 2
GAP = 17.0           # space between the outer edges of neighbouring letters
B = 160.0            # baseline (leaves room for the ears and the l above)


def f(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def pt(cx, cy, r, deg):
    return cx + r * cos(radians(deg)), cy - r * sin(radians(deg))


class Glyph:
    def __init__(self, paths: list[str], left: float, right: float, color: str = "word"):
        self.paths, self.left, self.right, self.color = paths, left, right, color


def cat_c(x0: float, eyes: bool = False) -> Glyph:
    """The c as a cat head: an open ring with two ears drawn in the same stroke."""
    cx, cy, r = x0 + R + HW, B - X / 2, R
    a0, a1 = 34, 322                       # the opening faces right, like a mouth
    s, e = pt(cx, cy, r, a0), pt(cx, cy, r, a1)
    ring = f"M{f(s[0])},{f(s[1])} A{f(r)},{f(r)} 0 1 0 {f(e[0])},{f(e[1])}"
    paths = [ring]
    # ears: each is an inverted V standing on the ring, tip leaning slightly outward
    for base_a, base_b, tip_deg, tip_r in ((136, 104, 125, r + 27), (84, 53, 62, r + 27)):
        p, q, t = pt(cx, cy, r, base_a), pt(cx, cy, r, base_b), pt(cx, cy, tip_r, tip_deg)
        paths.append(f"M{f(p[0])},{f(p[1])} L{f(t[0])},{f(t[1])} L{f(q[0])},{f(q[1])}")
    if eyes:
        for ex in (cx - 14, cx + 6):
            paths.append(f'<circle cx="{f(ex)}" cy="{f(cy - 4)}" r="6.5"/>')
    right = s[0] + HW
    return Glyph(paths, x0, right, "cat")


def a(x0: float) -> Glyph:
    cx, cy = x0 + R + HW, B - X / 2
    stem = cx + R
    return Glyph([f"M{f(cx)},{f(cy)} m{f(-R)},0 a{f(R)},{f(R)} 0 1 0 {f(2 * R)},0 a{f(R)},{f(R)} 0 1 0 {f(-2 * R)},0",
                  f"M{f(stem)},{f(B - X + HW)} L{f(stem)},{f(B - HW)}"],
                 x0, stem + HW)


def t(x0: float) -> Glyph:
    sx = x0 + HW + 22
    foot = 24
    return Glyph([f"M{f(sx)},{f(B - 132)} L{f(sx)},{f(B - 36)} Q{f(sx)},{f(B - HW)} {f(sx + foot)},{f(B - HW)}",
                  f"M{f(sx - 22)},{f(B - X + HW)} L{f(sx + 26)},{f(B - X + HW)}"],
                 x0, sx + 26 + HW)


def l(x0: float) -> Glyph:
    sx = x0 + HW
    foot = 22
    return Glyph([f"M{f(sx)},{f(B - 152 + HW)} L{f(sx)},{f(B - 36)} Q{f(sx)},{f(B - HW)} {f(sx + foot)},{f(B - HW)}"],
                 x0, sx + foot + HW)


def y(x0: float) -> Glyph:
    """A u-shaped y whose descender curls up into a cat's tail."""
    rr = 38.0
    lx = x0 + HW
    rx = lx + 2 * rr
    top = B - X + HW
    u = (f"M{f(lx)},{f(top)} L{f(lx)},{f(B - 48)} "
         f"A{f(rr)},{f(rr)} 0 0 0 {f(rx)},{f(B - 48)}")
    tail = (f"M{f(rx)},{f(top)} L{f(rx)},{f(B + 12)} "
            f"C{f(rx)},{f(B + 52)} {f(lx - 4)},{f(B + 60)} {f(lx - 8)},{f(B + 32)} "
            f"C{f(lx - 9)},{f(B + 14)} {f(lx + 6)},{f(B + 8)} {f(lx + 14)},{f(B + 16)}")
    return Glyph([u, tail], x0, rx + HW)


def s(x0: float) -> Glyph:
    sx = x0 + HW + 31
    top, bot = B - X + HW, B - HW
    return Glyph([
        f"M{f(sx + 28)},{f(top + 11)} C{f(sx + 21)},{f(top + 2)} {f(sx + 10)},{f(top)} {f(sx)},{f(top)} "
        f"C{f(sx - 18)},{f(top)} {f(sx - 30)},{f(top + 10)} {f(sx - 30)},{f(top + 21)} "
        f"C{f(sx - 30)},{f(top + 34)} {f(sx - 16)},{f(B - 52)} {f(sx)},{f(B - 50)} "
        f"C{f(sx + 16)},{f(B - 48)} {f(sx + 31)},{f(bot - 32)} {f(sx + 31)},{f(bot - 19)} "
        f"C{f(sx + 31)},{f(bot - 7)} {f(sx + 18)},{f(bot)} {f(sx)},{f(bot)} "
        f"C{f(sx - 12)},{f(bot)} {f(sx - 25)},{f(bot - 4)} {f(sx - 31)},{f(bot - 13)}"],
        x0, sx + 31 + HW)


# per-pair spacing tweaks, in units: the open c and the t's crossbar need less room
KERN = {("c", "a"): -10, ("a", "t"): -6, ("t", "a"): -6, ("l", "y"): 2, ("s", "t"): -4}


def word(word_color: str, cat_color: str) -> tuple[list[str], float]:
    makers = {"a": a, "t": t, "l": l, "y": y, "s": s}
    x, prev, out = 8.0, None, []
    for ch in "catalyst":
        if prev:
            x += GAP + KERN.get((prev, ch), 0)
        g = cat_c(x) if ch == "c" else makers[ch](x)
        color = cat_color if g.color == "cat" else word_color
        out += [f'<path d="{d}" stroke="{color}"/>' for d in g.paths]
        x, prev = g.right, ch
    return out, x + 8


def svg(width: float, height: float, body: list[str], title: str, view_y: float = 0) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {f(view_y)} {f(width)} {f(height)}" '
            f'width="{f(width)}" height="{f(height)}" role="img" aria-label="{title}">'
            f"<title>{title}</title>"
            f'<g fill="none" stroke-width="{f(W)}" stroke-linecap="round" stroke-linejoin="round">'
            f'{"".join(body)}</g></svg>\n')


def main():
    top, bottom = B - 152 - 2, B + 60 + HW + 4     # tallest stroke (the l) to the tail
    for name, word_color in (("catalyst-logo.svg", INK), ("catalyst-logo-on-dark.svg", LIGHT)):
        body, width = word(word_color, ORANGE)
        (HERE / name).write_text(svg(width, bottom - top, body, "catalyst", top))

    # the mark: the cat-c alone, with eyes, in a square
    g = cat_c(0, eyes=True)
    size = 150.0
    ox = (size - (g.right - g.left)) / 2
    head_top = B - X / 2 - (R + 27) - HW            # ear tips
    oy = (size - (B + 1 - head_top)) / 2 - head_top
    body = [f'<g transform="translate({f(ox)} {f(oy)})">',
            *[d.replace("/>", f' fill="{ORANGE}" stroke="none"/>') if d.startswith("<") else f'<path d="{d}" stroke="{ORANGE}"/>' for d in g.paths], "</g>"]
    (HERE / "catalyst-mark.svg").write_text(svg(size, size, body, "catalyst mark"))
    print("wrote catalyst-logo.svg, catalyst-logo-on-dark.svg, catalyst-mark.svg")


if __name__ == "__main__":
    main()
