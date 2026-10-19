import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
sys.path.insert(0, HERE)
from quant import snap
from PIL import Image
d = json.load(open(HERE + 'build/sprites.json'))
STATES = ['idle', 'think', 'work', 'happy', 'dead']
CH = '123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
out = ["// Generated from the Gemini sprite sheets by process.py and gen_ts.py: '.' is",
       "// transparent, every other character indexes `palette` through PALETTE_KEYS.",
       "// The palette is snapped to the xterm-256 colors, so Terminal.app, which has no",
       "// 24-bit color, shows the same sprite as a truecolor terminal.",
       "export type Skin = 'pencil' | 'sprout' | 'crown'",
       "export type Face = 'idle' | 'think' | 'work' | 'happy' | 'dead'",
       "export const PALETTE_KEYS = '" + CH + "'",
       "export type Sprite = { palette: string[]; frames: Record<Face, string[]> }",
       "", "export const SPRITES: Record<Skin, Sprite> = {"]
preview = []
for skin in ['pencil', 'sprout', 'crown']:
    pal, frames, imgs = [], {}, []
    for st, grid in zip(STATES, d[skin]):
        rows = []
        im = Image.new('RGB', (len(grid[0]), len(grid)), (38, 38, 38))
        for y, r in enumerate(grid):
            line = ''
            for x, c in enumerate(r):
                if c is None: line += '.'; continue
                emit, shown = snap(c)
                im.putpixel((x, y), tuple(int(shown[i:i+2], 16) for i in (1, 3, 5)))
                if emit not in pal: pal.append(emit)
                line += CH[pal.index(emit)]
            rows.append(line)
        frames[st] = rows
        imgs.append(im)
    preview.append(imgs)
    out.append(f"  {skin}: {{")
    out.append("    palette: [" + ", ".join(f"'{p}'" for p in pal) + "],")
    out.append("    frames: {")
    for st in STATES:
        out.append(f"      {st}: [")
        out += [f"        '{r}'," for r in frames[st]]
        out.append("      ],")
    out.append("    },")
    out.append("  },")
    print(skin, len(pal), 'colors')
out.append("}")
open(sys.argv[1], 'w').write("\n".join(out) + "\n")
w, h = preview[0][0].size
sheet = Image.new('RGB', ((w + 2) * 5, (h + 2) * 3), (38, 38, 38))
for j, row in enumerate(preview):
    for i, im in enumerate(row): sheet.paste(im, (i * (w + 2) + 1, j * (h + 2) + 1))
sheet.resize((sheet.width * 12, sheet.height * 12), Image.NEAREST).save(HERE + 'build/shown256.png')
