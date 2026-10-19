"""Turns the Gemini sprite sheets into hooks/sprites.ts at their native pixel size.

Usage: python3 make_sprites.py            (sheets from $CLAWD_SHEETS, default ~/clawds)
       CLAWD_PREVIEW=/tmp python3 make_sprites.py   (also writes preview.png there)
The sheets are upscaled pixel art on a flat magenta background: each is sampled back to
one sample per art pixel, keyed, split into frames and aligned on the body's feet.
"""
import colorsys, json, os
from collections import Counter
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from native import to_native

SRC = os.environ.get('CLAWD_SHEETS', os.path.expanduser('~/clawds'))
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = {'sonnet': ('sonnet.png', 26), 'haiku': ('haiku.png', 20), 'opus': ('opus.png', 13)}
BADGES = ('clawds3.png', 16)
BADGE_NAMES = ['research', 'security', 'build', 'test', 'docs', 'integrate', 'design', 'lead']
STATES = ['idle', 'workA', 'workB', 'done', 'fail']
DARK = '#181420'      # outline and eyes, kept exact
SPARK = '#ffd98a'     # sparkles, kept exact
FIXED = [DARK, SPARK]
MAGENTA = np.array([255, 0, 255])

def key(rgb):
    d = np.sqrt(((rgb.astype(int) - MAGENTA) ** 2).sum(2))
    lab, _ = ndi.label(d < 85)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1]); edge.discard(0)
    bg = np.isin(lab, list(edge))
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    # A magenta-ish pixel is fringe only where it touches the background: a purple body keeps its insides.
    fringe = (r > 200) & (b > 200) & (g < 110) & ndi.binary_dilation(bg)
    return ~bg & ~fringe

def split(rgb, alpha, n):
    w = alpha.shape[1]
    cut = [round(i * w / n) for i in range(n + 1)]
    return [(rgb[:, cut[i]:cut[i + 1]], alpha[:, cut[i]:cut[i + 1]]) for i in range(n)]

def largest(alpha):
    lab, n = ndi.label(alpha)
    if n == 0: return alpha
    sizes = ndi.sum(alpha, lab, range(1, n + 1))
    return lab == 1 + int(np.argmax(sizes))

def to_hex(rgb, alpha):
    """Grid of colours: dark pixels snap to DARK, small bright specks (sparkles) to SPARK."""
    body = largest(alpha)
    luma = rgb.astype(int) @ [0.3, 0.59, 0.11]
    lab, n = ndi.label(alpha & ~body)
    grid = [[None] * alpha.shape[1] for _ in range(alpha.shape[0])]
    for y, x in zip(*np.where(alpha)):
        if not body[y, x]:
            size = (lab == lab[y, x]).sum()
            if size > 30 or luma[y, x] < 140: continue      # stray bits, not a sparkle
            grid[y][x] = SPARK
        elif luma[y, x] < 70:
            grid[y][x] = DARK
        else:
            grid[y][x] = '#%02x%02x%02x' % tuple(int(v) for v in rgb[y, x])
    return grid, body

def align(frames):
    """Bottom-centre of each body on one shared point, so the mascot does not jitter between states."""
    info = []
    for grid, body in frames:
        ys, xs = np.where(body)
        oy, ox = np.where(np.array([[p is not None for p in row] for row in grid]))
        info.append(((xs.min() + xs.max()) // 2, ys.max(), ox.min(), oy.min(), ox.max(), oy.max()))
    L = max(i[0] - i[2] for i in info); R = max(i[4] - i[0] for i in info)
    U = max(i[1] - i[3] for i in info); D = max(i[5] - i[1] for i in info)
    out = []
    for (grid, _), (ax, ay, *_r) in zip(frames, info):
        g = [[None] * (L + R + 1) for _ in range(U + D + 1)]
        for y, row in enumerate(grid):
            for x, p in enumerate(row):
                if p: g[y - ay + U][x - ax + L] = p
        out.append(g)
    return out

def model(name):
    f, p = MODELS[name]
    rgb, _ = to_native(f'{SRC}/{f}', p)
    alpha = key(rgb)
    return dict(zip(STATES, align([to_hex(c, a) for c, a in split(rgb, alpha, 5)])))

def tint(hexcol, hue):
    r, g, b = [int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb(hue, min(1, s * 1.05), min(1, v * 1.08))
    return '#%02x%02x%02x' % (int(r * 255), int(g * 255), int(b * 255))

def features(grid):
    """Dark pixels not joined to the transparent outside: eyes and mouths, not the outline."""
    H, W = len(grid), len(grid[0])
    dark = np.array([[p == DARK for p in row] for row in grid])
    empty = np.array([[p is None for p in row] for row in grid])
    lab, _ = ndi.label(dark, structure=np.ones((3, 3)))
    outline = set(np.unique(lab[ndi.binary_dilation(empty, structure=np.ones((3, 3))) & dark])) - {0}
    return {(y, x) for y in range(H) for x in range(W) if lab[y, x] and lab[y, x] not in outline}

MID_SCALE = (0.62, 0.8)  # width, height: narrower than tall, so a mascot is not wide in the terminal

def shrink(grid, W2, H2):
    """Any-size reduction with halve's rules: an eye keeps its pixel dark, outline is dropped
    (`outlined` redraws it), elsewhere the commonest body colour wins."""
    H, W = len(grid), len(grid[0])
    feat = features(grid)
    out = []
    for ty in range(H2):
        y0 = ty * H // H2; y1 = max(y0 + 1, (ty + 1) * H // H2)
        row = []
        for tx in range(W2):
            x0 = tx * W // W2; x1 = max(x0 + 1, (tx + 1) * W // W2)
            cells = [(y, x) for y in range(y0, y1) for x in range(x0, x1)]
            block = [grid[y][x] for y, x in cells if grid[y][x]]
            if len(block) * 2 < len(cells): row.append(None); continue
            if any(c in feat for c in cells): row.append(DARK); continue
            rest = [p for p in block if p != DARK]
            row.append(max(set(rest), key=rest.count) if rest else None)
        out.append(row)
    return out

def bordered(grid):
    """One empty pixel all round, room for the outline."""
    W = len(grid[0]) + 2
    return [[None] * W] + [[None] + r + [None] for r in grid] + [[None] * W]

def halve(grid):
    """2x2 -> 1 pixel. A feature pixel (eye) keeps its block dark; the outline is dropped (the small
    sprites get an even one from `outlined`); elsewhere the commonest body colour wins."""
    H, W = len(grid), len(grid[0])
    feat = features(grid)
    out = []
    for y in range(0, H, 2):
        row = []
        for x in range(0, W, 2):
            cells = [(yy, xx) for yy in (y, y + 1) for xx in (x, x + 1) if yy < H and xx < W]
            block = [grid[yy][xx] for yy, xx in cells if grid[yy][xx]]
            if len(block) < 2: row.append(None); continue
            if any(c in feat for c in cells): row.append(DARK); continue
            rest = [p for p in block if p != DARK]
            if not rest: row.append(None); continue  # outline only: `outlined` redraws it evenly
            row.append(max(set(rest), key=rest.count))
        out.append(row)
    return out

def unfringed(grid):
    """Drops pixels left over from the sheets' magenta background."""
    def magenta(p):
        if not p: return False
        r, g, b = (int(p[i:i + 2], 16) for i in (1, 3, 5))
        # Red and blue alike with almost no green: the key colour, or it mixed with the outline.
        # A purple body (opus, #a65ddb) keeps far more green and stays.
        return min(r, b) > 60 and abs(r - b) < 0.3 * max(r, b) and g < 0.4 * min(r, b)
    return [[None if magenta(p) else p for p in row] for row in grid]

def outlined(grid):
    """A one-pixel dark outline just outside the body, as the sheets draw it: drawn on the empty
    pixels beside a coloured one, so thin parts (a sprout, a crown) keep their colour."""
    H, W = len(grid), len(grid[0])
    out = [r[:] for r in grid]
    body = lambda y, x: 0 <= y < H and 0 <= x < W and grid[y][x] not in (None, DARK, SPARK)
    for y in range(H):
        for x in range(W):
            if grid[y][x] is None and any(body(y + dy, x + dx) for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1))):
                out[y][x] = DARK
    return out

def small_frames(half):
    half = {k: outlined(unfringed(g)) for k, g in half.items()}
    idle = half['idle']
    hop = [r[:] for r in idle[1:]] + [[None] * len(idle[0])]
    return {'idle': idle, 'workA': idle, 'workB': hop, 'done': half['done'], 'fail': half['fail']}

def eyes_even(frames):
    """Shifts a mascot by a row so its eyes start on an even pixel row: two pixel rows share one
    terminal cell, and eyes split across two cells show a gap in terminals like Terminal.app."""
    feat = features(frames['idle'])
    if not feat or min(y for y, _ in feat) % 2 == 0: return frames
    empty = lambda row: all(p is None for p in row)
    if all(empty(g[0]) for g in frames.values()):
        return {k: g[1:] + [[None] * len(g[0])] for k, g in frames.items()}
    if all(empty(g[-1]) for g in frames.values()):
        return {k: [[None] * len(g[0])] + g[:-1] for k, g in frames.items()}
    return frames

def pad(frames, H, W):
    return {k: [[None] * W for _ in range(H - len(g))] + [row + [None] * (W - len(row)) for row in g] for k, g in frames.items()}

NEAR = 52  # colours closer than this (RGB distance) are noise of one colour

def encode(frames):
    """Palette letters per pixel; the fixed colours keep their exact value. Colours are grouped from
    the commonest down: one near a group joins it (noise), a clearly different one (a green sprout,
    a gold crown) starts its own, however few pixels it has."""
    counts = Counter(p for g in frames.values() for row in g for p in row if p and p not in FIXED)
    rgb = lambda p: np.array([int(p[j:j + 2], 16) for j in (1, 3, 5)])
    groups = []  # [centre colour, members]
    for p, _ in counts.most_common():
        near = [g for g in groups if np.linalg.norm(rgb(g[0]) - rgb(p)) < NEAR]
        if near: near[0][1].append(p)
        else: groups.append([p, [p]])
    names = 'abcdefghijklmnopqrstuvwxyzCDEFGHIJKLMNOPQRSTUVWXYZ'  # A, B are the fixed colours
    if len(groups) > len(names): raise SystemExit(f'{len(groups)} colour groups: raise NEAR')
    letter, palette = {}, {}
    for (centre, members), name in zip(groups, names):
        palette[name] = centre
        for p in members: letter[p] = name
    for j, p in enumerate(FIXED):
        letter[p] = chr(ord('A') + j); palette[letter[p]] = p
    used = {letter[p] for g in frames.values() for row in g for p in row if p}
    return {k: v for k, v in palette.items() if k in used}, {k: [''.join(letter[p] if p else '.' for p in row) for row in g] for k, g in frames.items()}

def badges():
    f, p = BADGES
    rgb, _ = to_native(f'{SRC}/{f}', p)
    alpha = key(rgb)
    icons = [to_hex(c, a)[0] for c, a in split(rgb, alpha, 8)]
    crops = []
    for g in icons:
        ys = [y for y, row in enumerate(g) if any(row)]; xs = [x for row in g for x, p in enumerate(row) if p]
        crops.append([row[min(xs):max(xs) + 1] for row in g[min(ys):max(ys) + 1]])
    H = max(len(g) for g in crops); W = max(len(g[0]) for g in crops)
    H += H % 2
    centred = []
    for g in crops:
        top = (H - len(g)) // 2; left = (W - len(g[0])) // 2
        c = [[None] * W for _ in range(H)]
        for y, row in enumerate(g):
            for x, p in enumerate(row): c[top + y][left + x] = p
        centred.append(c)
    return dict(zip(BADGE_NAMES, centred))

def render(grid, s=6, bg=(30, 30, 36)):
    im = Image.new('RGB', (len(grid[0]) * s, len(grid) * s), bg)
    for y, row in enumerate(grid):
        for x, p in enumerate(row):
            if p: im.paste(tuple(int(p[i:i + 2], 16) for i in (1, 3, 5)), (x * s, y * s, (x + 1) * s, (y + 1) * s))
    return im

def decode(palette, rows):
    return [[palette[c] if c != '.' else None for c in r] for r in rows]

if __name__ == '__main__':
    sprites = {n: model(n) for n in MODELS}
    H = max(len(g) for fr in sprites.values() for g in fr.values()); H += H % 2
    W = max(len(g[0]) for fr in sprites.values() for g in fr.values())
    MW, MH = round(W * MID_SCALE[0]), round(H * MID_SCALE[1])
    mid = {n: {k: outlined(bordered(unfringed(shrink(g, MW, MH)))) for k, g in pad(fr, H, W).items()} for n, fr in sprites.items()}
    out = {n: dict(zip(('palette', 'frames'), encode(eyes_even(fr)))) for n, fr in mid.items()}
    small = {n: small_frames({k: halve(g) for k, g in pad(fr, H, W).items()}) for n, fr in sprites.items()}
    sh = max(len(g) for fr in small.values() for g in fr.values()); sh += sh % 2
    sw = max(len(g[0]) for fr in small.values() for g in fr.values())
    out_small = {n: dict(zip(('palette', 'frames'), encode(eyes_even(pad(fr, sh, sw))))) for n, fr in small.items()}
    bd = {k: outlined(unfringed(halve(g))) for k, g in badges().items()}
    bp, bf = encode(bd)
    out_badges = {'palette': bp, 'frames': bf}
    bh, bw = len(next(iter(bd.values()))), len(next(iter(bd.values()))[0])

    order = ['haiku', 'sonnet', 'opus']
    def block(entry, keys):
        return (f"    palette: {json.dumps(entry['palette'])},\n    frames: {{\n" +
                ',\n'.join(f"      {k}: {json.dumps(entry['frames'][k])}" for k in keys) + "\n    },")
    ts = ("// Generated by tools/make_sprites.py from the Gemini sprite sheets in ~/clawds: re-run it, do not edit.\n"
          "// Each frame is rows of palette letters, '.' transparent; two pixel rows make one terminal row.\n\n"
          "export type SpriteModel = 'haiku' | 'sonnet' | 'opus'\n"
          "export type SpriteState = 'idle' | 'workA' | 'workB' | 'done' | 'fail'\n"
          f"export type BadgeName = {' | '.join(repr(b) for b in BADGE_NAMES)}\n"
          "export type Sheet<K extends string> = { palette: Record<string, string>; frames: Record<K, string[]> }\n\n"
          f"/** {MW + 2}x{MH + 2} pixels per frame: the sheets shrunk, narrower than tall. */\n"
          "export const SPRITES: Record<SpriteModel, Sheet<SpriteState>> = {\n" +
          '\n'.join(f"  {n}: {{\n{block(out[n], STATES)}\n  }}," for n in order) + "\n}\n\n"
          f"/** {sw}x{sh} pixels per frame: the sheets at half size. */\n"
          "export const SMALL_SPRITES: Record<SpriteModel, Sheet<SpriteState>> = {\n" +
          '\n'.join(f"  {n}: {{\n{block(out_small[n], STATES)}\n  }}," for n in order) + "\n}\n\n"
          f"/** {bw}x{bh} pixels per badge (half the sheet size). */\n"
          f"export const BADGES: Sheet<BadgeName> = {{\n{block(out_badges, BADGE_NAMES)}\n}}\n")
    open(os.path.join(HERE, '..', 'hooks', 'sprites.ts'), 'w').write(ts)
    print('sprite', MW + 2, 'x', MH + 2, 'small', sw, 'x', sh, 'badge', bw, 'x', bh)

    prev = os.environ.get('CLAWD_PREVIEW')
    if prev:
        rows = [[render(decode(out_small[n]['palette'], out_small[n]['frames'][s]), 12) for s in STATES] for n in order]
        rows.append([render(decode(bp, bf[b]), 12) for b in BADGE_NAMES])
        Wd = max(sum(i.width + 12 for i in r) for r in rows); Hd = sum(max(i.height for i in r) + 12 for r in rows)
        sheet = Image.new('RGB', (Wd, Hd), (30, 30, 36)); y = 0
        for r in rows:
            x = 0
            for im in r: sheet.paste(im, (x, y)); x += im.width + 12
            y += max(i.height for i in r) + 12
        sheet.save(os.path.join(prev, 'preview.png'))
