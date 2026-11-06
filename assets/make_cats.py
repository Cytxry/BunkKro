"""Make BunkKro's extra cats from the original orange poses (same lines, same proportions, new coats).

    python assets/make_cats.py          (writes the cat-<coat>-<pose> and cat-fairy-* files)

Coats:
  black     tuxedo: charcoal fur, white chest and muzzle, yellow eyes, light face lines so the face reads on dark fur
  grey      silver: cool grey fur
  lavender  pastel lilac fur (the site's indigo family)
  pink      pastel rose fur
  mint      pastel mint fur
  fairy     the guide: soft lilac Persian with wings, a flower crown and a star wand (she talks in the guide)
A plain white coat was tried and dropped: it read as blank next to the coloured cats.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
FUR, BELLY, EYE = "#F6C99B", "#FFF6EC", "#343F83"
COATS = {
    "black": {"fur": "#4A4D63", "belly": "#F4F1FA", "eye": "#F2C14E", "face": "#F4F1FA", "stripe": "#383A4E"},
    "grey": {"fur": "#C3C8D6", "belly": "#F3F4F8", "eye": EYE, "face": None, "stripe": "#A6ADBF"},
    "lavender": {"fur": "#D5C9F4", "belly": "#F7F3FF", "eye": EYE, "face": None, "stripe": "#B7A6EA"},
    "pink": {"fur": "#F6C3D3", "belly": "#FFF3F6", "eye": EYE, "face": None, "stripe": "#E9A3B9"},
    "mint": {"fur": "#B9E3CF", "belly": "#F1FBF6", "eye": EYE, "face": None, "stripe": "#93CDB2"},
    "fairy": {"fur": "#EAE2FC", "belly": "#FFFFFF", "eye": "#4F78C4", "face": None, "stripe": "#D6C9F7"},
}
POSES = {   # source pose -> the new files made from it
    "happy": ["black", "grey", "lavender", "pink", "mint"], "wave": ["black", "grey", "lavender", "mint"],
    "peek": ["black", "grey", "pink", "mint"], "confused": ["black", "grey", "lavender"], "sad": ["black", "lavender", "pink"],
    "moon": ["black", "lavender", "mint"], "laptop": ["black", "grey", "pink", "mint"], "coffee": ["black", "grey", "pink"],
    "books": ["black", "lavender", "mint"], "detective": ["black", "lavender"], "trophy": ["black", "pink", "mint"],
}


BLUE_FUR, BLUE_STRIPE, BLUE_BELLY, STRIPE = "#C9CEEC", "#9AA2D6", "#E8EAF8", "#E9A86F"


def recolor(svg: str, coat: dict) -> str:
    if svg.count(BLUE_FUR) >= 3:                      # a pose drawn from the blue cat (peek)
        svg = svg.replace(BLUE_FUR, FUR).replace(BLUE_STRIPE, STRIPE).replace(BLUE_BELLY, BELLY)
    svg = svg.replace(STRIPE, coat["stripe"])
    out = svg.replace(FUR, coat["fur"]).replace(BELLY, coat["belly"]).replace(f'fill="{EYE}" stroke="none"',
                                                                             f'fill="{coat["eye"]}" stroke="none"')
    if coat["face"]:
        # on dark fur the face lines (closed eyes, mouth, brows) are drawn light, inside the head group only
        def lighten(m):
            head = re.sub(r'<path ([^>]*?)fill="none"(?![^>]*stroke=)', rf'<path \1fill="none" stroke="{coat["face"]}"', m[0])
            return head
        out = re.sub(r'<g transform="rotate\([^)]*\)">.*?</g>', lighten, out, count=1, flags=re.S)
    return out


WINGS = """  <g opacity=".92">
    <path d="M58 92C30 70 14 82 22 100C28 114 46 112 60 104Z" fill="#E4DDFB" stroke="#9C8FE0" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M60 104C40 112 34 124 44 130C52 134 62 124 64 112Z" fill="#F1ECFD" stroke="#9C8FE0" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M102 92C130 70 146 82 138 100C132 114 114 112 100 104Z" fill="#E4DDFB" stroke="#9C8FE0" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M100 104C120 112 126 124 116 130C108 134 98 124 96 112Z" fill="#F1ECFD" stroke="#9C8FE0" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M30 92q10 2 20 8M130 92q-10 2-20 8" fill="none" stroke="#B9ADF0" stroke-width="1.6" stroke-linecap="round"/>
  </g>
"""
STAR = 'M0-7C1-1 1-1 7 0C1 1 1 1 0 7C-1 1-1 1-7 0C-1-1-1-1 0-7Z'


def fairy(svg: str, wand_from: tuple[float, float] | None) -> str:
    """Wings behind the cat, sparkles, and (when the pose has a raised paw) a star wand."""
    i = svg.index("<g ")                                   # the drawing starts here: wings go underneath it
    svg = svg[:i] + WINGS + svg[i:]
    extra = []
    if wand_from:
        x, y = wand_from
        extra.append(f'<path d="M{x} {y}L{x + 12} {y - 22}" fill="none" stroke="#8A6FD1" stroke-width="3" stroke-linecap="round"/>')
        extra.append(f'<path transform="translate({x + 14} {y - 26}) scale(1.25)" d="{STAR}" fill="#F2C14E" stroke="#D99A2B" stroke-width="1"/>')
    extra += [f'<path transform="translate(26 30) scale(.6)" d="{STAR}" fill="#B9ADF0"/>',
              f'<path transform="translate(140 108) scale(.55)" d="{STAR}" fill="#F4A6A6"/>',
              '<circle cx="146" cy="30" r="2.4" fill="#B9ADF0"/><circle cx="16" cy="70" r="2" fill="#F2C14E"/>',
              # a little flower crown between the ears
              '<g stroke="#343F83" stroke-width="1.4"><circle cx="72" cy="40" r="3.4" fill="#F4A6A6"/>'
              '<circle cx="80" cy="37" r="3.8" fill="#F2C14E"/><circle cx="88" cy="40" r="3.4" fill="#B9ADF0"/></g>']
    j = svg.rindex("</svg>")
    return svg[:j] + "  " + "\n  ".join(extra) + "\n" + svg[j:]


def main():
    made = []
    for pose, coats in POSES.items():
        src = (HERE / f"cat-{pose}.svg").read_text(encoding="utf-8")
        for name in coats:
            out = recolor(src, COATS[name])
            out = re.sub(r'aria-label="A ', f'aria-label="A {name} ', out, count=1)
            (HERE / f"cat-{name}-{pose}.svg").write_text(out, encoding="utf-8")
            made.append(f"cat-{name}-{pose}.svg")
    # the guide: a white fairy Persian, waving with a wand, cheering, thinking, and peeking
    white = COATS["fairy"]
    for pose, wand in (("wave", (119, 66)), ("happy", None), ("confused", (103, 47)), ("peek", None)):
        src = recolor((HERE / f"cat-{pose}.svg").read_text(encoding="utf-8"), white)
        out = fairy(src, wand)
        out = re.sub(r'aria-label="[^"]*"', 'aria-label="Fairy, the BunkKro guide cat"', out, count=1)
        (HERE / f"cat-fairy-{pose}.svg").write_text(out, encoding="utf-8")
        made.append(f"cat-fairy-{pose}.svg")
    print(len(made), "cats:", ", ".join(made))


if __name__ == "__main__":
    main()
