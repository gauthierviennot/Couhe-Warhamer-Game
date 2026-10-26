import sys, re
sys.path.insert(0, '/tmp/claude-0/-home-claude/8a1d2d25-009b-5d55-ac63-e56de8fa5fdd/scratchpad')
SP = '/tmp/claude-0/-home-claude/8a1d2d25-009b-5d55-ac63-e56de8fa5fdd/scratchpad/'
head = open(SP + 'debut_pdf.py').read().split('\ns=[]')[0]
exec(head)
from reportlab.platypus import PageBreak, KeepTogether, Table, TableStyle, Spacer
import figures as FG

cap = ParagraphStyle('cap', parent=body, fontName='SI', fontSize=8.2, leading=11, textColor=colors.HexColor('#4a4a4a'), spaceBefore=2, spaceAfter=8)
annex = ParagraphStyle('annex', parent=h1, fontSize=17, leading=21, spaceBefore=0, spaceAfter=6)
toc = ParagraphStyle('toc', parent=body, fontSize=10.5, leading=16)
num = {'n': 0}


def fig(fn):
    d, c = fn()
    num['n'] += 1
    if isinstance(d, list) and d[0].width + d[1].width + 20 > 480:
        t = Table([[d[0]], [d[1]]]); t.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER')]))
        el = t
    elif isinstance(d, list):
        t = Table([d], colWidths=[d[0].width + 10, d[1].width + 10])
        t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (0, 0), (-1, -1), 'CENTER')]))
        el = t
    else:
        t = Table([[d]]); t.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER')])); el = t
    return KeepTogether([el, Paragraph(f'<b>Figure {num["n"]}.</b> {c}', cap)])


def part(file):
    code = open(SP + file).read()
    bodycode = code[code.index('\ns=[]'):code.index('\ndef foot')]
    for old, new in [('document REGLE-VISION', 'Annexe A'), ('REGLE-VISION', 'Annexe A'), ('REGLES-CHARGE', 'Annexe B'), ('REGLES-GENERAL', 'Annexe C'), ('REGLES-BONUS-ARMEE', 'Annexe D'), ('REGLES-TIR', 'Annexe E'), ('fiche de règles', 'règle')]:
        bodycode = bodycode.replace(old, new)
    ns = dict(globals())
    exec(bodycode, ns)
    return ns['s'][2:]  # sans le titre ni le sous-titre


def insert_after(lst, text, items):
    for i, el in enumerate(lst):
        if hasattr(el, 'text') and text in el.text:
            lst[i + 1:i + 1] = items if isinstance(items, list) else [items]
            return
    raise ValueError('introuvable : ' + text)


def insert_before(lst, text, items):
    for i, el in enumerate(lst):
        if hasattr(el, 'text') and text in el.text:
            lst[i:i] = items if isinstance(items, list) else [items]
            return
    raise ValueError('introuvable : ' + text)


from copy import copy
HL = colors.HexColor('#fff1a8')
CHANGES_SUMMARY = [
    '<b>§ 7 — Film des charges et des déplacements</b> : les déplacements sont maintenant dans le film, après les charges, image par image (une image = un pas d’une tuile).',
    '<b>§ 1</b> : étiquettes = sigle + numéro unique par joueur, sans nom d’unité (nom dans la fiche, deux touchers).',
    '<b>§ 4</b> : au placement, pas de passage par l’eau ni la montagne ; pont seulement d’une extrémité à l’autre.',
    '<b>§ 8</b> : appui long sur une unité (même adverse) : sa capacité de déplacement depuis sa position actuelle.',
    '<b>§ 2</b> : après le placement de bataille, disques et marqueurs + masqués (conservés) ; les triangles restent (points forts).',
]
NEEDLES = ['<b>Film des charges et des déplacements</b>', '<b>Étiquettes des unités</b>', 'on ne passe ni par l’eau ni par la montagne', '<b>Capacité de déplacement d’une unité</b>', '<b>Une fois le placement de bataille terminé</b>']


def hl_par(el):
    st = copy(el.style); st.backColor = HL; st.borderPadding = 2
    return Paragraph(el.text, st, bulletText=getattr(el, 'bulletText', None))


def mark(lst, needles=None, all_=False):
    needles = NEEDLES if needles is None else needles
    for i, el in enumerate(lst):
        if isinstance(el, Paragraph):
            if el.style.name == 'nohl':
                continue
            if all_ or any(n in el.text for n in needles):
                lst[i] = hl_par(el)
        elif isinstance(el, KeepTogether):
            mark(el._content, needles, all_)
        elif isinstance(el, Table):
            for row in el._cellvalues:
                for j, cell in enumerate(row):
                    if isinstance(cell, Paragraph) and (all_ or any(n in cell.text for n in needles)):
                        row[j] = hl_par(cell)
                    elif isinstance(cell, list):
                        mark(cell, needles, all_)
    return lst


S = []
S.append(Spacer(1, 40))
S.append(P('Règles du jeu', ParagraphStyle('big', parent=h1, fontSize=30, leading=36)))
S.append(P('Du débarquement à la charge — règles générales et annexes détaillées', ParagraphStyle('bs', parent=sub, fontSize=12, leading=16)))
S.append(P('Version du 26/10/2026, validée par le MJ. Ce document rassemble toutes les règles écrites jusqu’ici ; les figures illustrent les exemples (bleu : équipe 1, rouge : équipe 2, gris : autre unité ; la pointe d’une unité montre son orientation).', body))
S.append(Spacer(1, 14))
S.append(P('Sommaire', h2))
for line in ['<b>Règles générales</b> — du début de partie à la charge',
             '<b>Annexe A</b> — La vision', '<b>Annexe B</b> — La charge (avec les tirailleurs, le soutien et la zone d’interdiction)',
             '<b>Annexe C</b> — Le général', '<b>Annexe D</b> — Les bonus d’armée',
             '<b>Annexe E</b> — Le tir', '<b>Annexe F</b> — Points restant à traiter']:
    S.append(P('• ' + line, toc))
S.append(Spacer(1, 10))
S.append(P('Modifications depuis le dernier envoi (26/10/2026, 23 h 30)', h2))
S.append(P('Les passages modifiés sont <font backColor="#fff1a8">surlignés en jaune</font> dans tout le document ; les figures modifiées ont leur légende surlignée.', body))
NOHL = ParagraphStyle('nohl', parent=bul)
S += [Paragraph(t, NOHL, bulletText='•') for t in CHANGES_SUMMARY]
S.append(PageBreak())

# ---------- Règles générales ----------
S.append(P('Règles générales — du début de partie à la charge', annex))
G = part('debut_pdf.py')
insert_after(G, 'Une unité volante en vol n’a ni malus', fig(FG.f_sides))
insert_before(G, '5. Tours suivants : la pose des ordres', fig(FG.f_placement))
insert_before(G, '9. Vision (résumé)', fig(FG.f_exclusion))
S += mark(G)
S.append(PageBreak())

# ---------- Annexe A : vision ----------
A = []
A.append(P('Annexe A — La vision', annex))
A.append(P('Elle vaut pour les charges (vision fixée à la révélation des ordres) et pour les tirs (vision au moment du tir).', sub))
A.append(P('1. La méthode', h2))
A += B(['On trace un trait du centre de la tuile de l’unité qui agit (qui charge ou qui tire) au centre de la tuile de la cible.',
        'Seules comptent les tuiles traversées entre les deux. <b>Une tuile frôlée par le trait, même par un seul coin, compte comme traversée</b> (par exemple une montagne dont le trait coupe un coin bloque la vue). La tuile de chaque unité ne gêne pas sa propre vue, sauf la forêt (§ 9).',
        'Si le trait longe exactement le bord entre deux tuiles, il suffit qu’un des deux côtés soit dégagé.',
        'Une unité amie a exactement le même effet qu’une unité ennemie.',
        '<b>Résultat :</b> charge visible ou « sans voir » (œil ou œil barré, avec la raison) ; tir : modificateur « sans voir » +4 coché si la cible n’est pas visible ; artillerie : la vision décide si la relance sur 4 peut toucher.'])
A.append(P('2. Niveaux et obstacles', h2))
A.append(box([['Niveau', 'Terrain'],
              ['0', 'plaine et terrains plats (route, marais, eau)'],
              ['1', 'colline ; fortification, demi-fortification ou village à toit plat en plaine'],
              ['2', 'fortification, demi-fortification ou village à toit plat sur une colline']], [24 * mm, 150 * mm]))
A += B(['Forêt et village simple : obstacles au niveau de leur tuile ; ils n’ajoutent pas de niveau.',
        'La montagne bloque toujours la vue. Ne bloquent jamais : muret, pont, route, eau, marais, terrain plat.',
        'Une unité est au niveau de sa tuile ; sur une fortification ou un village à toit plat, elle voit à 360°.'])
A.append(P('3. Les types d’unités', h2))
A.append(box([['Type', 'Voit et est vue par-dessus les unités', 'Par-dessus relief, forêts, constructions', 'Bloque entre deux autres', 'Cachée par un abri collé'],
              ['Au sol, saut', 'non', 'non', 'oui (même niveau)', 'oui'],
              ['Grande taille', 'oui', 'non', 'oui (même niveau)', 'oui'],
              ['Volante au sol', 'oui', 'non', 'oui (même niveau)', 'oui'],
              ['Volante en vol', 'oui', 'oui (sauf montagne)', 'non', 'non']], [28 * mm, 40 * mm, 40 * mm, 34 * mm, 32 * mm]))
A += B(['Une unité volante (v, vs) choisit à chaque ordre « en vol » (par défaut) ou « au sol », pour tout le tour ; au sol, elle se déplace comme une unité au sol. Ce choix est caché à l’adversaire ; la vision d’une charge contre elle est recalculée à la révélation.'])
A.append(P('4. Réciprocité et ses deux exceptions', h2))
A += B(['Si A voit B, B voit A. Deux exceptions seulement :',
        '<b>Action vers l’arrière :</b> si le trait part par l’un des 3 côtés arrière de l’unité qui charge ou qui tire, elle agit sans voir (sauf vue à 360° sur fortification, demi-fortification ou village à toit plat).',
        '<b>Unité dans une forêt</b> (au sol, grande taille ou volante au sol) : on ne la voit pas, mais elle voit.'])
A.append(fig(FG.f_sides))
A.append(P('5. Les abris', h2))
A += B(['Une unité est cachée si la tuile juste à côté d’elle sur le trait est un abri : forêt, village (simple ou à toit plat), fortification, colline plus haute qu’elle. Pour l’unité qui agit comme pour la cible ; pas pour les unités volantes en vol.',
        'Réciproque : l’unité abritée ne voit pas non plus de ce côté. Quand les deux unités sont à des niveaux différents, une unité juste à côté n’est pas un abri.'])
A.append(P('6. Deux unités au même niveau', h2))
A += B(['Bloquent, où qu’ils soient sur le trait : montagne ; tuile plus haute que les deux unités ; au même niveau : forêt, village, fortification ; au même niveau : une unité sur le trait, <b>qu’elle soit petite, de grande taille ou volante restée au sol</b> (seule une unité volante en vol ne cache pas la vue) — sauf si l’une des deux unités qui se regardent est une grande taille ou une unité volante, qui voit par-dessus.',
        'Une tuile plus basse ne bloque pas, avec tout ce qu’elle porte.'])
A.append(fig(FG.f_vision_same))
A.append(P('7. Deux unités à des niveaux différents', h2))
A += B(['Bloqué seulement par : une montagne ; un relief aussi haut que l’unité haute (tuile traversée de niveau égal ou supérieur) ; un abri juste à côté de l’une des deux unités.',
        'Exemples : pied et bord de colline côte à côte → se voient ; pied et milieu d’une colline de 3 tuiles → non ; unité sur une fortification isolée → voit toute la plaine, sauf unité collée à un abri.'])
A.append(fig(FG.f_abri))
A.append(P('8. Une unité volante en vol', h2))
A += B(['Elle voit sa cible et en est vue, sauf : montagne sur le trait ; action vers l’arrière ; cible <b>à l’intérieur</b> d’une forêt (et pas en vol).',
        'Une unité cachée <b>derrière</b> une forêt (à côté d’elle, pas dedans) est visible d’une unité volante en vol.'])
A.append(P('9. La forêt (prioritaire)', h2))
A += B(['Unité au sol, grande taille ou volante au sol dans une forêt : toujours cachée, même juste à côté, même d’une unité en vol ; elle voit les autres avec ses propres règles. Unité volante en vol dans une forêt : elle voit et on la voit.'])
A.append(P('10. Tirailleurs', h2))
A += B(['Les tirailleurs ne gênent pas la vision de l’unité qu’ils protègent quand elle charge (Annexe B § 9).'])
S += mark(A)
S.append(PageBreak())

# ---------- Annexe B : charge ----------
S.append(P('Annexe B — La charge', annex))
C = part('charge4_pdf.py')
insert_before(C, '5. Ordre des charges', fig(FG.f_revers))
insert_before(C, '7. L’arrivée d’une charge simple', fig(FG.f_path))
insert_before(C, '8. Les charges mutuelles', fig(FG.f_facets))
insert_before(C, '9. Les tirailleurs', [fig(FG.f_mutual), fig(FG.f_bridge)])
insert_before(C, '10. Effets de la charge au corps à corps', [fig(FG.f_skirm), fig(FG.f_skirm2)])
insert_before(C, '12. Zone d’interdiction', fig(FG.f_support))
S += mark(C)
S.append(PageBreak())

# ---------- Annexe C : général ----------
S.append(P('Annexe C — Le général', annex))
Gn = part('gen_pdf.py')
insert_before(Gn, '2. Désigner le général', fig(FG.f_general))
S += Gn
S.append(PageBreak())

# ---------- Annexe D : bonus d'armée ----------
S.append(P('Annexe D — Les bonus d’armée', annex))
S += part('ba_pdf.py')
S.append(PageBreak())

# ---------- Annexe F : le tir ----------
S.append(P('Annexe E — Le tir', annex))
S += mark(part('tir_pdf.py'), all_=True)
S.append(PageBreak())

# ---------- Annexe E : points à confirmer ----------
S.append(P('Annexe F — Points restant à traiter', annex))
S += B(['<b>Charge échouée</b> (cas qui ne devrait pas arriver en jeu) : l’unité avance au maximum de sa capacité de charge ; à confirmer : capacité de charge ou capacité de déplacement maximale.',
        '<b>Zone d’interdiction</b> : l’exception de « hauteur infranchissable » de l’ancien fichier est remplacée par la différence de hauteur (déplacement simple).',
        '<b>Corps à corps</b> (pas encore automatisé) : ordre de résolution des mêlées, report des blessures, réorientation, débordement et débordement héroïque, berserk, attaque double.',
        '<b>Relance du général</b> : règle écrite (Annexe C), pas encore automatisée.',
        '<b>Morts-vivants</b> (peur : jet de fuite adverse +1) : appliqué à la main par le MJ.',
        '<b>Tir</b> : tir dans une mêlée (dés à 1 sur l’unité juste avant la cible sur la ligne de tir, à confirmer) ; unités alliées dans une mêlée touchées par l’artillerie (à résoudre plus tard) ; sur un 4 suivi de 1 à 3 avec vision, tuile du nouveau dé (à confirmer) (Annexe E § 11).',
        '<b>Débordement</b> (après un tir ou au corps à corps) : règles à venir.'])


def foot(c, d):
    c.saveState(); c.setFont('S', 7.5); c.setFillColor(colors.HexColor('#8a8f98'))
    c.drawString(18 * mm, 10 * mm, 'Règles du jeu — du débarquement à la charge'); c.drawRightString(A4[0] - 18 * mm, 10 * mm, 'page %d' % d.page); c.restoreState()


doc = SimpleDocTemplate('/home/claude/p2/REGLES-COMPLETES.pdf', pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm, title='Règles du jeu', author='MJ')
import export_html
export_html.export(S, CHANGES_SUMMARY, 'Version du 26/10/2026 — même contenu que REGLES-COMPLETES.pdf.', '/home/claude/p2/public/regles.html')
doc.build(mark(S), onFirstPage=foot, onLaterPages=foot)
print('figures', num['n'])
