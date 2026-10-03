"""Builds the Catalyst logos: the word in Fredoka SemiBold, converted to outlines, with cat ears on the C.

Usage (from the repo root): uv run --with fonttools python assets/logo/build_logo.py
Downloads Fredoka (SIL Open Font License) into assets/logo/.font/ on first run.
"""

import urllib.request
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = Path(__file__).parent
FONT_URL = "https://github.com/google/fonts/raw/main/ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf"
FONT = HERE / ".font" / "Fredoka.ttf"

ORANGE, PINK = "#F59A3C", "#FF9FB0"
INK, LIGHT = "#2B2D42", "#FFF6EC"
WORD = "Catalyst"
CAP = 100.0          # rendered cap height in px
TRACKING = -0.01     # em


def load_font() -> TTFont:
    if not FONT.exists():
        FONT.parent.mkdir(exist_ok=True)
        urllib.request.urlretrieve(FONT_URL, FONT)
    return instantiateVariableFont(TTFont(FONT), {"wght": 600, "wdth": 100})


def glyph_path(font, glyph, scale, x, baseline):
    pen = SVGPathPen(font.getGlyphSet())
    font.getGlyphSet()[glyph].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
    return pen.getCommands()


def bounds(font, glyph, scale, x, baseline):
    pen = BoundsPen(font.getGlyphSet())
    font.getGlyphSet()[glyph].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
    return pen.bounds  # xmin, ymin, xmax, ymax in SVG coordinates


def ears(c_bounds, cap):
    """Two rounded cat ears sitting on the top arc of the C, drawn behind it."""
    x0, top, x1, _ = c_bounds
    w, h = x1 - x0, cap * 0.36
    out = []
    for a, b, lean in ((0.04, 0.46, -0.10), (0.42, 0.84, 0.10)):
        l, r = x0 + a * w, x0 + b * w
        tip = ((l + r) / 2 + lean * w, top - h)
        base_y = top + cap * 0.16
        # outer ear with a softly rounded tip
        out.append(
            f'<path d="M{l:.1f},{base_y:.1f} L{tip[0] - 5:.1f},{tip[1] + 8:.1f} '
            f'Q{tip[0]:.1f},{tip[1] - 2:.1f} {tip[0] + 5:.1f},{tip[1] + 8:.1f} L{r:.1f},{base_y:.1f} Z" '
            f'fill="{ORANGE}" stroke="{ORANGE}" stroke-width="6" stroke-linejoin="round"/>')
        il, ir = l + (r - l) * 0.3, r - (r - l) * 0.3
        out.append(
            f'<path d="M{il:.1f},{top + 2:.1f} L{tip[0]:.1f},{tip[1] + h * 0.38:.1f} L{ir:.1f},{top + 2:.1f} Z" '
            f'fill="{PINK}" stroke="{PINK}" stroke-width="3" stroke-linejoin="round"/>')
    return out


def build(font):
    cmap, hmtx = font.getBestCmap(), font["hmtx"]
    cap_units = font["OS/2"].sCapHeight or 700
    scale = CAP / cap_units
    ear_room = CAP * 0.5
    baseline = ear_room + CAP + 4
    x, paths, c_bounds = 6.0, [], None
    for i, ch in enumerate(WORD):
        glyph = cmap[ord(ch)]
        d = glyph_path(font, glyph, scale, x, baseline)
        if i == 0:
            c_bounds = bounds(font, glyph, scale, x, baseline)
        paths.append((i == 0, d))
        x += hmtx[glyph][0] * scale + TRACKING * CAP / 0.7
    width = x + 6
    descent = CAP * 0.32
    height = baseline + descent
    return paths, c_bounds, width, height


def svg(width, height, body, title="Catalyst"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
            f'width="{width:.0f}" height="{height:.0f}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{"".join(body)}</svg>\n')


def main():
    font = load_font()
    paths, c_bounds, width, height = build(font)
    ear_paths = ears(c_bounds, CAP)
    for name, word_color in (("catalyst-logo.svg", INK), ("catalyst-logo-on-dark.svg", LIGHT)):
        body = [*ear_paths] + [f'<path d="{d}" fill="{ORANGE if is_c else word_color}"/>' for is_c, d in paths]
        (HERE / name).write_text(svg(width, height, body))

    # the mark: the eared C alone, centred in a square
    x0, _, x1, y1 = c_bounds
    top = c_bounds[1] - CAP * 0.36 - 4
    size = max(x1 - x0, y1 - top) + 24
    ox, oy = (size - (x1 - x0)) / 2 - x0, (size - (y1 - top)) / 2 - top
    c_path = paths[0][1]
    mark = [f'<g transform="translate({ox:.1f} {oy:.1f})">', *ear_paths, f'<path d="{c_path}" fill="{ORANGE}"/>', "</g>"]
    (HERE / "catalyst-mark.svg").write_text(svg(size, size, mark, "Catalyst mark"))
    print("wrote catalyst-logo.svg, catalyst-logo-on-dark.svg, catalyst-mark.svg")


if __name__ == "__main__":
    main()
