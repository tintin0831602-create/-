import numpy as np
from PIL import Image

def best_grid(gray, axis, p0):
    g = np.abs(np.diff(gray, axis=axis)).sum(axis=1 - axis)
    n = len(g)
    best = (-1, p0, 0)
    for p in np.arange(p0 - 1.0, p0 + 1.0, 0.05):
        for off in np.arange(0, p, 0.5):
            idx = np.round(np.arange(off, n - 1, p)).astype(int)
            idx = idx[idx < n]
            s = g[idx].mean()
            if s > best[0]: best = (s, p, off)
    return best[1], best[2]

def to_native(path, p0):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(float)
    gray = a.mean(2)
    px, ox = best_grid(gray, 1, p0)
    py, oy = best_grid(gray, 0, p0)
    W, H = a.shape[1], a.shape[0]
    xs = np.arange(ox + px / 2, W, px).astype(int)
    ys = np.arange(oy + py / 2, H, py).astype(int)
    xs = xs[xs < W]; ys = ys[ys < H]
    # sample a small window around each cell centre (median) to shrug off JPEG noise
    out = np.zeros((len(ys), len(xs), 3), np.uint8)
    r = max(2, int(min(px, py) // 5))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            blk = a[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1].reshape(-1, 3)
            out[j, i] = np.median(blk, axis=0)
    return out, (px, py, ox, oy)

if __name__ == '__main__':
    for f, p in [('clawd.png', 26), ('clawd1.png', 20), ('clawd2.png', 26), ('clawd3.png', 32)]:
        out, info = to_native(f'/Users/jasperlin79/clawds/{f}', p)
        print(f, out.shape, [round(float(v), 2) for v in info])
        Image.fromarray(out).resize((out.shape[1] * 4, out.shape[0] * 4), Image.NEAREST).save(f'native_{f}')
