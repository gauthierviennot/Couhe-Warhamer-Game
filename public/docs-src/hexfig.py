"""Figures hexagonales (grille odd-r, hexagones « pointy-top ») pour les règles du jeu."""
import math
from reportlab.graphics.shapes import Drawing, Polygon, Line, String, Circle, Group
from reportlab.lib import colors
from reportlab.lib.units import mm

COL = {
    'plain': colors.HexColor('#f4efe2'), 'hill': colors.HexColor('#d9c48f'), 'mountain': colors.HexColor('#8d8478'),
    'water': colors.HexColor('#9cc3e0'), 'swamp': colors.HexColor('#b7c9a6'), 'path': colors.HexColor('#e2d2b4'),
}
OBJ = {'forest': ('#4f7f3a', 'F'), 'village': ('#a0522d', 'V'), 'village-flat': ('#b5651d', 'Vt'), 'fortress': ('#555555', 'Ft'),
       'wall': ('#777777', 'm'), 'bridge': ('#8b5a2b', 'P')}
TEAM = {1: colors.HexColor('#1f5fbf'), 2: colors.HexColor('#c0392b'), 0: colors.HexColor('#6d6d6d')}
EDGE = colors.HexColor('#b9ad94')


def nb(key, d):
    c, r = key
    odd = r % 2 == 1
    table = {0: (1, 0), 3: (-1, 0)}
    if odd:
        table.update({1: (1, 1), 2: (0, 1), 4: (0, -1), 5: (1, -1)})
    else:
        table.update({1: (0, 1), 2: (-1, 1), 4: (-1, -1), 5: (0, -1)})
    dc, dr = table[d % 6]
    return (c + dc, r + dr)


def dist(a, b):
    def cube(k):
        c, r = k
        x = c - (r - (r & 1)) // 2
        return x, -x - r, r
    A, B = cube(a), cube(b)
    return max(abs(A[i] - B[i]) for i in range(3))


class Fig:
    def __init__(self, cols, rows, R=14.5):
        self.cols, self.rows, self.R = cols, rows, R
        self.w = math.sqrt(3) * R * (cols + 0.5) + 4
        self.h = 1.5 * R * (rows - 1) + 2 * R + 4
        self.d = Drawing(self.w, self.h)
        self.terrain, self.obj, self.fill, self.labels = {}, {}, {}, {}
        self.units, self.lines, self.edges, self.outline = [], [], [], {}

    def xy(self, k):
        c, r = k
        R = self.R
        x = 2 + math.sqrt(3) * R * (c + 0.5 * (r & 1)) + math.sqrt(3) * R / 2
        y = self.h - (2 + R + 1.5 * R * r)
        return x, y

    def corners(self, k, scale=1.0):
        x, y = self.xy(k)
        R = self.R * scale
        pts = []
        for i in range(6):
            a = math.radians(-(30 + 60 * i))  # écran : y vers le bas ; dessin : y vers le haut
            pts += [x + R * math.cos(a), y + R * math.sin(a)]
        return pts

    def edge_pts(self, k, d):
        x, y = self.xy(k)
        R = self.R
        a1, a2 = math.radians(-(d * 60 - 30)), math.radians(-(d * 60 + 30))
        return x + R * math.cos(a1), y + R * math.sin(a1), x + R * math.cos(a2), y + R * math.sin(a2)

    def render(self):
        g = self.d
        for r in range(self.rows):
            for c in range(self.cols):
                k = (c, r)
                fc = self.fill.get(k) or COL.get(self.terrain.get(k, 'plain'))
                g.add(Polygon(self.corners(k), fillColor=fc, strokeColor=EDGE, strokeWidth=0.5))
                if k in self.outline:
                    col, wdt = self.outline[k]
                    g.add(Polygon(self.corners(k, 0.86), fillColor=None, strokeColor=colors.HexColor(col), strokeWidth=wdt))
                if k in self.obj:
                    col, lab = OBJ[self.obj[k]]
                    x, y = self.xy(k)
                    g.add(Polygon(self.corners(k, 0.55), fillColor=colors.HexColor(col), strokeColor=None))
                    g.add(String(x, y - 2.8, lab, fontName='SB', fontSize=7.5, fillColor=colors.white, textAnchor='middle'))
        for (x1, y1, x2, y2, col, w) in self.edges:
            g.add(Line(x1, y1, x2, y2, strokeColor=colors.HexColor(col), strokeWidth=w))
        for (a, b, col, dash, w, head) in self.lines:
            x1, y1 = self.xy(a) if isinstance(a, tuple) else a
            x2, y2 = self.xy(b) if isinstance(b, tuple) else b
            g.add(Line(x1, y1, x2, y2, strokeColor=colors.HexColor(col), strokeWidth=w, strokeDashArray=dash))
            if head:
                ang = math.atan2(y2 - y1, x2 - x1)
                s = self.R * 0.45
                p = [x2, y2, x2 - s * math.cos(ang - 0.45), y2 - s * math.sin(ang - 0.45), x2 - s * math.cos(ang + 0.45), y2 - s * math.sin(ang + 0.45)]
                g.add(Polygon(p, fillColor=colors.HexColor(col), strokeColor=None))
        for (k, lab, team, orient) in self.units:
            x, y = self.xy(k)
            R = self.R * 0.58
            col = TEAM.get(team, team)
            if orient is not None:
                a = math.radians(-orient * 60)
                tip = (x + self.R * 0.98 * math.cos(a), y + self.R * 0.98 * math.sin(a))
                b1 = (x + R * 0.95 * math.cos(a + 0.8), y + R * 0.95 * math.sin(a + 0.8))
                b2 = (x + R * 0.95 * math.cos(a - 0.8), y + R * 0.95 * math.sin(a - 0.8))
                g.add(Polygon([tip[0], tip[1], b1[0], b1[1], b2[0], b2[1]], fillColor=col, strokeColor=None))
            g.add(Circle(x, y, R, fillColor=col, strokeColor=colors.white, strokeWidth=0.8))
            g.add(String(x, y - 3, lab, fontName='SB', fontSize=8.5 if len(lab) < 3 else 7, fillColor=colors.white, textAnchor='middle'))
        for k, (lab, col) in self.labels.items():
            x, y = self.xy(k)
            g.add(String(x, y - 3, lab, fontName='SB', fontSize=8, fillColor=colors.HexColor(col), textAnchor='middle'))
        return g

    # aides
    def unit(self, k, lab, team, orient=None):
        self.units.append((k, lab, team, orient))

    def arrow(self, a, b, col='#222222', dash=None, w=1.1, head=True):
        self.lines.append((a, b, col, dash, w, head))

    def path(self, keys, col='#222222', dash=(2, 2), w=1.1):
        for i in range(len(keys) - 1):
            self.arrow(keys[i], keys[i + 1], col, dash, w, i == len(keys) - 2)

    def sides(self, k, orient, front='#2e7d32', rear='#c62828', w=2.2):
        for d in range(6):
            diff = (d - orient) % 6
            col = front if diff in (0, 1, 5) else rear
            x1, y1, x2, y2 = self.edge_pts(k, d)
            self.edges.append((x1, y1, x2, y2, col, w))
