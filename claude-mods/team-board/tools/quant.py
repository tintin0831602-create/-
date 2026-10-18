# Snap a color to the xterm-256 cell it really shows as, and give back an RGB
# that chalk's 256-color downgrade maps to exactly that cell, so the sprite
# looks the same in a truecolor terminal and in Terminal.app.
LV = [0, 95, 135, 175, 215, 255]
def candidates():
    for r in range(6):
        for g in range(6):
            for b in range(6):
                # an RGB as near the shown level as chalk's rounding (v / 51) allows
                emit = tuple(max(51*i - 25, min(51*i + 25, LV[i])) for i in (r, g, b))
                if not (r == g == b): yield (LV[r], LV[g], LV[b]), emit
    for k in range(24):
        v = 8 + 10*k
        # the gray nearest the shown one that chalk still maps to ramp step k
        ok = [u for u in range(8, 249) if round((u - 8) / 247 * 24) == k]
        emit = min(ok, key=lambda u: abs(u - v))
        yield (v, v, v), (emit, emit, emit)
CANDS = list(candidates())
def dist(a, b):
    rm = (a[0] + b[0]) / 2
    dr, dg, db = a[0]-b[0], a[1]-b[1], a[2]-b[2]
    return (2 + rm/256)*dr*dr + 4*dg*dg + (2 + (255-rm)/256)*db*db
def snap(hexs):
    c = tuple(int(hexs.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
    shown, emit = min(CANDS, key=lambda t: dist(t[0], c))
    return '#%02x%02x%02x' % emit, '#%02x%02x%02x' % shown
if __name__ == '__main__':
    import sys
    for h in sys.argv[1:]: print(h, '->', *snap(h))
