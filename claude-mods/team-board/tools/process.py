import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

import os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
IMG = HERE + 'source-art/'
OUT = HERE + 'build/'
os.makedirs(OUT, exist_ok=True)

def load(name):
    im = Image.open(IMG + name).convert('RGB')
    a = np.asarray(im).astype(int)
    # magenta background: high R, high B, low G
    bg = (a[:,:,0] > 200) & (a[:,:,2] > 200) & (a[:,:,1] < 110)
    return a, ~bg

def components(mask, min_area):
    # dilate a little so outline + tiny gaps stay together
    lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=3))
    objs = ndimage.find_objects(lab)
    out = []
    for i, sl in enumerate(objs):
        area = (mask[sl] & (lab[sl] == i+1)).sum()
        if area >= min_area:
            out.append((sl, lab == i+1))
    out.sort(key=lambda t: t[0][1].start)
    return out

def extract(name, min_area, cell_w, cell_h):
    a, fg = load(name)
    comps = components(fg, min_area)
    crops = []
    for sl, m in comps:
        sub = a[sl].copy()
        alpha = (fg[sl] & m[sl])
        crops.append((sub, alpha))
    # one common scale for the whole sheet, bottom/center aligned
    mw = max(c[0].shape[1] for c in crops)
    mh = max(c[0].shape[0] for c in crops)
    scale = min(cell_w / mw, cell_h / mh)
    frames = []
    OUTLINE = (24, 18, 28)
    for sub, alpha in crops:
        h, w = alpha.shape
        nw, nh = max(1, round(w*scale)), max(1, round(h*scale))
        canvas = np.zeros((cell_h, cell_w, 4), np.uint8)
        x0 = (cell_w - nw)//2
        y0 = cell_h - nh
        ys = np.linspace(0, h, nh+1).astype(int)
        xs = np.linspace(0, w, nw+1).astype(int)
        for j in range(nh):
            for i in range(nw):
                blk = sub[ys[j]:ys[j+1], xs[i]:xs[i+1]].reshape(-1, 3)
                al = alpha[ys[j]:ys[j+1], xs[i]:xs[i+1]].reshape(-1)
                if al.size == 0 or al.mean() < 0.5:
                    continue
                px = blk[al]
                dark = px.sum(axis=1) < 150
                if dark.mean() >= 0.4:
                    col = OUTLINE
                else:
                    lit = px[~dark] if (~dark).any() else px
                    col = np.median(lit, axis=0).astype(int)
                canvas[y0+j, x0+i] = (*col, 255)
        # eyes: compact dark blobs in the source, top part of the face
        dk = alpha & (sub.sum(axis=2) < 150)
        lab, n = ndimage.label(dk)
        sizes = ndimage.sum(dk, lab, range(1, n+1)) if n else []
        cand = []
        for k in range(1, n+1):
            ys_, xs_ = np.where(lab == k)
            if sizes[k-1] < 120 or sizes[k-1] == max(sizes): continue
            fy = ys_.mean() / h
            if not (0.25 < fy < 0.6): continue
            ring = ndimage.binary_dilation(lab == k, iterations=12) & ~(lab == k)
            if not alpha[ring].all(): continue          # must sit inside the body, not on its edge
            if (dk & ring).sum() > 0.02 * ring.sum(): continue   # and not glued to the outline
            cand.append((ys_.mean(), xs_.mean(), sizes[k-1]))
        best = None
        for i in range(len(cand)):
            for j in range(i+1, len(cand)):
                a_, b_ = cand[i], cand[j]
                score = abs(a_[0]-b_[0]) + abs(a_[2]-b_[2])**0.5 + a_[0]*0.05
                if abs(a_[1]-b_[1]) > w*0.15 and (best is None or score < best[0]):
                    best = (score, a_, b_)
        pair = sorted([best[1][:2], best[2][:2]], key=lambda c: c[1]) if best else []
        eyes = [(y0 + sy / h * nh, x0 + sx / w * nw) for sy, sx in pair]
        frames.append((canvas, eyes))
    return frames


FACES = {
    'idle':     [[1,1],[1,1]],
    'think':    [[0,0,1,1],[0,0,1,1]],   # eyes glance right
    'work':     [[1,1,0,0],[1,1,0,0]],   # eyes glance left
    'happy':    [[0,1,0],[1,0,1]],
    'dead':     [[1,0,1],[0,1,0],[1,0,1]],
}
STATES = ['idle', 'think', 'work', 'happy', 'dead']

SMALL_FACES = {
    'idle':  [[1],[1]],
    'think': [[0,1],[0,1]],
    'work':  [[1,0],[1,0]],
    'happy': [[0,1,0],[1,0,1]],
    'dead':  [[1,0,1],[0,1,0],[1,0,1]],
}

def repaint_face(canvas, eyes, state):
    if len(eyes) < 2: return canvas
    rgb = canvas[:,:,:3].astype(int)
    solid = canvas[:,:,3] > 0
    dark = solid & (rgb.sum(axis=2) < 150)
    fill = np.median(rgb[solid & ~dark], axis=0).astype(int)
    n = canvas.shape[0]
    g = np.array((FACES if n >= 20 else SMALL_FACES)[state]); gh, gw = g.shape
    rx = max(1, round(3*n/24)); ry = max(1, round(2*n/24))
    for cy, cx in eyes:
        for yy in range(int(cy)-ry, int(cy)+ry+1):
            for xx in range(int(cx)-rx, int(cx)+rx+1):
                if 0 <= yy < canvas.shape[0] and 0 <= xx < canvas.shape[1] and dark[yy, xx]:
                    canvas[yy, xx] = (*fill, 255)
    for cy, cx in eyes:
        y0 = int(round(cy - gh/2)); x0 = int(round(cx - (min(gw, 3) if n >= 20 else gw)/2))
        for j in range(gh):
            for i in range(gw):
                if g[j][i]: canvas[y0+j, x0+i] = (24, 18, 28, 255)
    return canvas

def hexgrid(canvas):
    rows = []
    for r in canvas:
        rows.append([('%02x%02x%02x' % tuple(p[:3])) if p[3] else None for p in r])
    return rows

def preview(frames, path, zoom=12):
    h, w = frames[0].shape[:2]
    sheet = Image.new('RGB', ((w+2)*len(frames), h+2), (30,30,36))
    for i, f in enumerate(frames):
        im = Image.fromarray(f, 'RGBA')
        sheet.paste(im, (i*(w+2)+1, 1), im)
    sheet = sheet.resize((sheet.width*zoom, sheet.height*zoom), Image.NEAREST)
    sheet.save(path)

if __name__ == '__main__':
    W = H = int(sys.argv[1]) if len(sys.argv) > 1 else 16
    data = {}
    for key, name, area, cw, ch in [
        ('pencil', 'pencil.webp', 20000, W, H),
        ('sprout', 'sprout.webp', 20000, W, H),
        ('crown',  'crown.webp', 20000, W, H),
        ('icons',  'icons.webp', 3000, 12, 12),
    ]:
        fr = extract(name, area, cw, ch)
        if key == 'icons':
            fr = [f[0] for f in fr]
        else:
            base, eyes = fr[0]
            fr = [repaint_face(base.copy(), eyes, st) for st in STATES]
        print(key, len(fr), 'frames')
        preview(fr, OUT + key + '.png')
        data[key] = [hexgrid(f) for f in fr]
    json.dump(data, open(OUT + 'sprites.json', 'w'))
