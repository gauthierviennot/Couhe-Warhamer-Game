"""Figures d'exemple des règles."""
from hexfig import Fig, nb, dist

GREEN, BLUE, GOLD, RED, GREY = '#bfe3b4', '#bcd7f0', '#f3d27a', '#f2b8b0', '#d6d6d6'


def bfs(start, n, blocked=set(), cols=9, rows=7):
    d = {start: 0}
    fr = [start]
    for step in range(1, n + 1):
        nx = []
        for k in fr:
            for dd in range(6):
                m = nb(k, dd)
                if not (0 <= m[0] < cols and 0 <= m[1] < rows) or m in d or m in blocked:
                    continue
                d[m] = step
                nx.append(m)
        fr = nx
    return d


def f_placement():
    f = Fig(14, 9, R=12)
    zone = [(c, 0) for c in range(1, 13)]
    ends = [(1, 0), (12, 0)]
    crosses = [(3, r) for r in range(1, 6)] + [(10, r) for r in range(1, 6)]
    discs = [(c, 6) for c in range(14)]
    home = (6, 0)
    dmap = bfs(home, 12, set(discs), 14, 9)
    area = {k for k in dmap if 4 <= k[0] <= 9 and 1 <= k[1] <= 5}
    normal = {home}
    for k, d in dmap.items():
        if k == home or k in zone:
            continue
        if d <= 2:
            f.fill[k] = GREEN; normal.add(k)
        elif d <= 4 and k in area:
            f.fill[k] = BLUE; normal.add(k)
    seen = {k: 0 for k in normal}
    fr = list(normal)
    for step in range(1, 4):
        nx = []
        for k in fr:
            for dd in range(6):
                m = nb(k, dd)
                if not (0 <= m[0] < 14 and 0 <= m[1] < 9) or m in seen or m in discs or m in zone:
                    continue
                seen[m] = step; nx.append(m)
        fr = nx
    for k, st in seen.items():
        if st > 0 and k not in f.fill:
            f.fill[k] = '#f7e6b0'
    for k in zone:
        f.outline[k] = ('#7b1fa2', 1.4)
        if k != home:
            f.labels[k] = ('▲' if k in ends else '◆', '#7b1fa2')
    for k in crosses:
        f.labels[k] = ('+', '#c62828')
    for k in discs:
        f.labels[k] = ('●', '#c62828')
    f.unit(home, 'il', 1, 1)
    return f.render(), "Placement. La zone de débarquement (contour violet ◆, extrémités ▲) a trois sections : les deux extrémités et le centre. Les marqueurs + délimitent leurs aires de bonus ; la ligne de disques (●) est une frontière. L’unité d’infanterie légère (dep 3) du centre : sa tuile de dépôt compte pour 1, elle va à 2 tuiles (vert) ; le bonus de section (+2 ici, fixé par le MJ) s’ajoute seulement dans l’aire de bonus du centre, entre les marqueurs + (bleu) ; avec le chevron du général, 3 tuiles de plus (jaune), sans franchir la frontière."


def f_sides():
    f = Fig(5, 3)
    f.sides((2, 1), 0)
    f.unit((2, 1), 'iL', 1, 0)
    f.labels[(3, 1)] = ('avant', '#2e7d32')
    f.labels[(1, 1)] = ('arrière', '#c62828')
    return f.render(), "Orientation : l’unité regarde vers l’est (pointe). Ses 3 côtés avant (vert) et ses 3 côtés arrière (rouge). Un trait qui passe exactement par un sommet entre un côté avant et un côté arrière compte comme avant."


def f_vision_same():
    f = Fig(7, 2)
    a, b = (0, 0), (6, 0)
    f.obj[(3, 0)] = 'forest'
    f.unit(a, 'A', 1, 0); f.unit(b, 'B', 2, 3)
    f.arrow(a, b, '#c62828', (3, 2), 1.0, False)
    g = Fig(7, 2)
    g.terrain[(0, 0)] = 'hill'; g.obj[(3, 0)] = 'forest'
    g.unit(a, 'A', 1, 0); g.unit(b, 'B', 2, 3)
    g.arrow(a, b, '#2e7d32', None, 1.0, False)
    return [f.render(), g.render()], "Vision. À gauche : même niveau, une forêt sur le trait bloque (A et B ne se voient pas). À droite : A est sur une colline (niveau 1) ; la forêt en plaine est plus basse et n’est pas collée à B : ils se voient."


def f_abri():
    f = Fig(7, 2)
    a, b = (0, 0), (6, 0)
    f.terrain[a] = 'hill'; f.obj[(5, 0)] = 'forest'
    f.unit(a, 'A', 1, 0); f.unit(b, 'B', 2, 3)
    f.arrow(a, b, '#c62828', (3, 2), 1.0, False)
    g = Fig(7, 2)
    g.unit(a, 'A', 1, 0); g.unit((3, 0), 'il', 0, None); g.unit(b, 'B', 2, 3)
    g.arrow(a, b, '#c62828', (3, 2), 1.0, False)
    return [f.render(), g.render()], "À gauche : abri. B a une forêt juste devant lui sur le trait : il est caché, même pour A en hauteur (et B ne voit pas A de ce côté). À droite : une unité au sol sur le trait, au même niveau, bloque la vue (sauf si A ou B est une grande taille ou une unité volante)."


def f_revers():
    f = Fig(5, 5)
    t, a = (2, 1), (2, 3)
    f.sides(t, 5)
    f.unit(t, 'T', 2, 5); f.unit(a, 'A', 1, 5)
    f.arrow(a, t, '#c62828', None, 1.2)
    g = Fig(5, 5)
    g.sides((2, 3), 1)
    g.unit((2, 1), 'T', 2, 1); g.unit((2, 3), 'A', 1, 1)
    g.arrow((2, 3), (2, 1), '#c62828', (3, 2), 1.2)
    return [f.render(), g.render()], "À gauche : prise à revers. La cible T regarde vers le nord-est ; le trait vers l’attaquant A sort par un de ses côtés arrière (rouge). À droite : dans son dos. A regarde vers le sud-est ; le trait vers sa cible part par l’un de ses côtés arrière : A charge sans voir."


def f_path():
    f = Fig(7, 5)
    a, t = (1, 2), (5, 2)
    for r in range(5):
        if r != 4:
            f.terrain[(3, r)] = 'water'
    f.unit(a, 'A', 1, 0); f.unit(t, 'T', 2, 3)
    f.path([a, (1, 3), (2, 4), (3, 4), (4, 4), (4, 3)], '#2e7d32')
    g = Fig(7, 3)
    for k in [(2, 0), (3, 0), (2, 2), (3, 2), (3, 1)]:
        g.unit(k, 'u', 0)
    g.unit((1, 1), 'A', 1, 0); g.unit((5, 1), 'T', 2, 3)
    g.path([(1, 1), (2, 1), (3, 1), (4, 1)], '#c62828')
    return [f.render(), g.render()], "Chemin de charge. À gauche : une rivière (eau, sans pont) ne cache pas la vue — A voit T — mais elle ne se franchit pas : A la contourne par le chemin autorisé le plus court et arrive au contact de T. Une unité au sol peut aussi passer sous une unité volante en vol, sans s’arrêter sur sa tuile. À droite : aucun chemin libre à la révélation des ordres ; A traverse les unités sur son passage (dans sa portée) : la charge est sans voir (ici, l’unité sur le trait cache aussi la vue)."


def f_facets():
    import math
    f = Fig(7, 6)
    t, a = (3, 3), (3, 0)
    o = 4
    f.sides(t, o)
    f.unit(t, 'T', 2, o)
    f.unit(a, 'A', 1, 2)
    (x1, y1), (x2, y2) = f.xy(t), f.xy(a)
    d0 = round(math.degrees(math.atan2(-(y2 - y1), x2 - x1)) / 60) % 6
    f0 = nb(t, d0)
    f.labels[f0] = ('1', '#1b5e20')
    front = [(o + k) % 6 for k in (0, 1, 5)]
    for d in front:
        if nb(t, d) != f0:
            f.labels[nb(t, d)] = ('2', '#1b5e20')
    for d in range(6):
        if d not in front:
            f.labels[nb(t, d)] = ('3', '#b71c1c')
    f.labels[(5, 1)] = ('4', '#555555')
    f.arrow(a, f0, '#222222', (2, 2), 1.0)
    return f.render(), "Facette de charge (charge de face : T regarde vers le nord-ouest). 1 : la facette la plus proche de l’attaquant A (le trait de centre à centre). 2 : si elle est prise, les autres facettes de la charge (ici les facettes avant). 3 : en surnombre seulement, quand 1 et 2 sont prises, étalement sur les autres facettes (sans prise à revers ce tour-ci). 4 : toutes les facettes accessibles prises : deuxième rideau, au plus près du combat en respectant le déplacement de charge (soutien sans combat)."


def f_mutual():
    f = Fig(9, 2)
    a, b = (0, 0), (8, 0)
    f.unit(a, 'A', 1, 0); f.unit(b, 'B', 2, 3)
    f.labels[(4, 0)] = ('A', '#1f5fbf'); f.labels[(5, 0)] = ('B', '#c0392b')
    f.outline[(4, 0)] = ('#1f5fbf', 1.4); f.outline[(5, 0)] = ('#c0392b', 1.4)
    g = Fig(9, 2)
    g.obj[(2, 0)] = 'forest'
    g.unit(a, 'A', 1, 0); g.unit(b, 'B', 2, 3)
    g.outline[(2, 0)] = ('#1f5fbf', 1.6); g.outline[(3, 0)] = ('#c0392b', 1.6)
    g.path([b, (7, 0), (6, 0), (5, 0), (4, 0), (3, 0)], '#c0392b')
    return [f.render(), g.render()], "Charge mutuelle. En haut : 7 tuiles libres entre A et B, sans décor : rencontre au milieu (nombre impair : un d10 donne une tuile de plus au meilleur). En bas : sur sa moitié du trajet, A croise une forêt (+2), B ne croise rien : A peut s’arrêter dans la forêt et B vient à son contact, même au-delà de sa portée."


def f_bridge():
    f = Fig(7, 3)
    for c in range(7):
        f.terrain[(c, 1)] = 'water'
    f.obj[(3, 1)] = 'bridge'
    f.unit((3, 0), 'A', 1, 2); f.unit((3, 2), 'B', 2, 5)
    f.outline[(3, 0)] = ('#c79100', 1.6); f.outline[(3, 2)] = ('#c79100', 1.6)
    return f.render(), "Charge mutuelle par un pont : chaque unité est sur sa tuile d’entrée de pont. Un d10 désigne de quel côté du pont a lieu la charge ; l’autre unité traverse le pont pour venir au contact ; le modificateur de pont ne s’applique à aucune des deux. En charge simple, la cible à la sortie du pont garde son +2 (sauf contre une unité volante en vol ou qui saute)."


def f_skirm():
    f = Fig(6, 6)
    p, t, e = (2, 4), (2, 3), (2, 0)
    f.unit(p, 'P', 1, 5); f.unit(t, 'T', 1, 5); f.unit(e, 'E', 2, 1)
    f.arrow(e, nb(t, 5), '#c0392b', (2, 2), 1.0)
    g = Fig(6, 6)
    g.unit(t, 'P', 1, 5); g.unit(p, 'T', 1, 5); g.unit(nb(t, 5), 'E', 2, 2)
    return [f.render(), g.render()], "Tirailleurs. À gauche : T (tirailleurs, ordre « tirailleur ») est sur la tuile juste devant P (unité de corps à corps) qui les regarde, tournés dans la même direction. E charge P : sa charge se dirige vers T (distance mesurée jusqu’à T) ; T tire sur E pendant la phase de tir. À droite : à la fin des tirs, P et T échangent leurs places ; le corps à corps a lieu entre E et P (sauvegarde +1 pour P)."


def f_skirm2():
    f = Fig(6, 6)
    p, t, e = (2, 4), (2, 3), (1, 0)
    f.unit(p, 'P', 1, 5); f.unit(t, 'T', 1, 5); f.unit(e, 'E', 2, 1)
    f.path([p, t, (2, 2), (1, 1)], '#1f5fbf')
    g = Fig(6, 6)
    g.unit((1, 1), 'P', 1, 4); g.unit((2, 2), 'T', 1, 4); g.unit(e, 'E', 2, 1)
    return [f.render(), g.render()], "L’unité protégée P charge E : elle traverse ses tirailleurs sans malus (ils ne gênent pas sa vision). À droite : les tirailleurs l’accompagnent et se placent juste derrière elle, avec la même orientation."


def f_exclusion():
    f = Fig(7, 5)
    e = (3, 2)
    f.unit(e, 'E', 2, 3)
    f.terrain[nb(e, 0)] = 'hill'
    for d in range(6):
        k = nb(e, d)
        if d == 0:
            f.outline[k] = ('#2e7d32', 1.6)
        else:
            f.fill[k] = RED
    f.unit((0, 2), 'A', 1, 0)
    return f.render(), "Zone d’interdiction : en déplacement (sauf charge), A ne peut pas s’arrêter au contact de l’adversaire E (rouge). Exception : la tuile de colline, d’un autre niveau que celle de E (contour vert). Pas de zone d’interdiction au placement."


def f_support():
    f = Fig(8, 5)
    a, d = (3, 2), (4, 2)
    f.unit(d, 'D', 2, 3); f.unit(a, 'A', 1, 0)
    f.unit((1, 2), 'Sr', 1, 0)
    f.unit((5, 2), 'Sa', 1, 3)
    f.labels[(0, 0)] = ('', '#000')
    return f.render(), "Soutien au corps à corps : A combat D. Sr, unité alliée libre de corps à corps ou mixte à 2 hex au plus derrière A : soutien arrière. Sa, unité alliée (libre, ou ici prenant D à revers), à 2 hex au plus devant A : soutien avant. Chacun donne att −1 (corps à corps), cumulables. Une unité en deuxième rideau soutient de la même façon."


def f_general():
    f = Fig(21, 19, R=8)
    g = (10, 9)
    for r in range(19):
        for c in range(21):
            dd = dist((c, r), g)
            if 0 < dd <= 6:
                f.fill[(c, r)] = GREEN
            elif 6 < dd <= 9:
                f.fill[(c, r)] = BLUE
    f.unit(g, 'G', 1, None)
    return f.render(), "Portée du général : ses pouvoirs (chevron, mvt +3, charge +2, att −1, relance) touchent les unités à 6 hex ou moins (vert), sa propre unité comprise. Empire (général d’exception) : 9 hex (vert et bleu). Ce n’est pas une portée de déplacement."


def f_artillery():
    import math
    f = Fig(12, 3)
    art, pt = (0, 1), (9, 1)
    f.unit(art, 'art', 1, 0)
    line = [(c, 1) for c in range(1, 10)]
    for k in line:
        f.fill[k] = '#efe7cf'
    for i, k in enumerate([(7, 1), (8, 1), (9, 1)]):
        f.fill[k] = '#f7d79a'
        f.labels[k] = (str(i + 1), '#8a4b00')
    f.outline[pt] = ('#c62828', 1.8)
    f.unit((8, 1), 'E', 2, 3)
    return f.render(), "Artillerie : le joueur indique le point maximal (contour rouge), à 10 hex au plus. Le d4 donne la tuile où tombe le projectile parmi les 3 tuiles consécutives qui finissent à ce point (1 la plus proche, 3 le point) ; 4 : nouveau d4 (tuile si la machine voit le point ; 4 : incident, la machine perd ses propres points d’attaque). Ici, sur un 2, le projectile tombe sur E : E perd l’attaque de la machine (15 ou 20 PV) sur une seule figurine, sans armure."


def f_fire():
    f = Fig(9, 3)
    s_, t = (0, 1), (8, 1)
    f.unit(s_, 'T', 1, 0)
    f.unit(t, 'C', 2, 3)
    for c in range(1, 4):
        f.fill[(c, 1)] = '#bfe3b4'
    for c in range(4, 8):
        f.fill[(c, 1)] = '#f3d27a'
    f.labels[(3, 1)] = ('3', '#1b5e20'); f.labels[(7, 1)] = ('7', '#8a6d00')
    return f.render(), "Portées de tir : courte jusqu’à 3 hex (vert), longue jusqu’à 7 hex (jaune, modificateur +3, +1 pour une arme lourde). Ici la cible C, à 8 hex, est hors de portée. Artillerie : 10 hex."
