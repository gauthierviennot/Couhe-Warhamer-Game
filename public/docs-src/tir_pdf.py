from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
F='/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('S', F+'DejaVuSans.ttf')); pdfmetrics.registerFont(TTFont('SB', F+'DejaVuSans-Bold.ttf')); pdfmetrics.registerFont(TTFont('SI', F+'DejaVuSans-Oblique.ttf'))
from reportlab.lib.fonts import addMapping
addMapping('S',0,0,'S'); addMapping('S',1,0,'SB'); addMapping('S',0,1,'SI'); addMapping('S',1,1,'SB')
INK=colors.HexColor('#1f2a37'); ACC=colors.HexColor('#7a4b12'); LINE=colors.HexColor('#c9b89a'); BG=colors.HexColor('#f5efe4')
body=ParagraphStyle('b',fontName='S',fontSize=9.5,leading=13.5,textColor=INK,spaceAfter=4)
small=ParagraphStyle('s',parent=body,fontSize=8.5,leading=11.5)
h1=ParagraphStyle('h1',fontName='SB',fontSize=19,leading=23,textColor=ACC,spaceAfter=2)
sub=ParagraphStyle('sub',parent=body,fontName='SI',textColor=colors.HexColor('#5b6573'),spaceAfter=10)
h2=ParagraphStyle('h2',fontName='SB',fontSize=12.5,leading=16,textColor=ACC,spaceBefore=10,spaceAfter=4)
h3=ParagraphStyle('h3',fontName='SB',fontSize=10.5,leading=14,textColor=INK,spaceBefore=6,spaceAfter=2)
bul=ParagraphStyle('bul',parent=body,leftIndent=12,bulletIndent=2,spaceAfter=2)
def P(t,s=body): return Paragraph(t,s)
def B(items): return [Paragraph(i,bul,bulletText='•') for i in items]
def box(rows, widths, head=True):
    t=Table([[P(c,small) for c in r] for r in rows],colWidths=widths,repeatRows=1 if head else 0)
    st=[('GRID',(0,0),(-1,-1),0.4,LINE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4)]
    if head: st+= [('BACKGROUND',(0,0),(-1,0),BG)]
    t.setStyle(TableStyle(st)); return t
def army(name, fiche, units, rules, status):
    out=[P(name,h2), P('<b>Texte de la fiche :</b> <i>« %s »</i>'%fiche)]
    if units: out.append(P('<b>Unités concernées (marquées BA) :</b> '+units))
    out.append(P('<b>Application</b>',h3)); out+=B(rules)
    out.append(P('<b>Dans le jeu :</b> '+status, small))
    return out




import figures as FG
from reportlab.platypus import Table, TableStyle, KeepTogether
cap = ParagraphStyle('cap', parent=body, fontName='SI', fontSize=8.2, leading=11, textColor=colors.HexColor('#4a4a4a'), spaceBefore=2, spaceAfter=8)
if 'fig' not in globals():
    NUM = {'n': 0}
    def fig(fn):
        d, c = fn(); NUM['n'] += 1
        t = Table([[d]]); t.setStyle(TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER')]))
        return KeepTogether([t, Paragraph(f'<b>Figure {NUM["n"]}.</b> {c}', cap)])
s=[]
s.append(P('Le tir',h1))
s.append(P('Règle validée par le MJ le 26/10/2026 (points restant à traiter au § 11)',sub))
s.append(P('1. Place dans le tour',h2))
s+=B(['Le tir vient <b>après les charges et les autres déplacements</b>, avant le corps à corps.',
 'D’abord <b>l’artillerie</b>, puis <b>les autres tirs</b>.',
 'Pour chacune des deux étapes, un <b>d10</b> par équipe désigne l’équipe qui commence (un dé pour l’artillerie, un autre pour les autres tirs) ; ensuite les équipes tirent <b>à tour de rôle</b>, une unité à la fois. Pas de dé si une seule équipe peut tirer.',
 'La cible, la vision et les modificateurs se décident <b>au moment du tir</b>, avec les positions de ce moment (après les déplacements).',
 'Le joueur vise sur la carte ; une <b>fenêtre de résolution</b> montre la cible, les modificateurs et le bouton « Jeter les dés » ; <b>le joueur qui tire lance les dés</b> (l’outil calcule ; en mode test et correction, c’est le MJ). Tous les joueurs voient le jet (en miniature s’ils ne sont pas concernés). Le MJ peut corriger les modificateurs, les pertes, et annuler la dernière action.'])
s.append(P('2. Qui peut tirer',h2))
s.append(box([['Ordre de l’unité','Tir possible ?'],
 ['Tir court / tir long','oui, à la portée de l’ordre'],
 ['Tir d’artillerie','oui (artillerie, seul ordre de tir possible pour elle)'],
 ['Déplacement','oui, avec le malus « après déplacement » +3 si l’unité a vraiment bougé (sauf dep+t, cavalerie légère) ; pas besoin d’ordre de tir'],
 ['Tirailleur','oui ; s’il est chargé, il tire sur l’unité qui l’a chargé (portée courte, sans malus)'],
 ['Marche forcée','non (aucune attaque)'],
 ['Charge','non']],[50*mm,124*mm]))
s.append(Spacer(1,4))
s+=B(['<b>Artillerie (art) et arme lourde (aL)</b> : pas de tir après un déplacement, ni si elles sont prises au corps à corps.',
 '<b>Unité mixte chargée</b> avec un ordre de tir : elle tire (malus « pris au corps à corps » +3), puis combat au corps à corps.',
 'Une unité ne tire qu’une fois par tour.'])
s.append(P('3. Portées',h2))
s+=B(['<b>Tir court</b> : 3 hex. <b>Tir long</b> : 7 hex, avec le modificateur de longue portée au-delà de 3 hex (+3, ou +1 pour une arme lourde).',
 '<b>Artillerie</b> : 10 hex (« 7 + 3 » dans le fichier de règles).',
 'L’artillerie ne peut pas viser l’unité du général (elle ignore l’artillerie).'])
s.append(fig(FG.f_fire))
s.append(P('4. Vision',h2))
s+=B(['Règle de vision complète : Annexe A, au moment du tir. Le trait part du centre du tireur vers le centre de la cible ; agir vers l’arrière (3 côtés arrière du tireur) = sans voir, sauf vue à 360° sur fortification ou village à toit plat.',
 'Cible non visible : modificateur <b>sans voir +4</b>.',
 'À la visée, les cibles possibles sont entourées : rouge = visible, gris pointillé = sans voir.'])
s.append(P('5. Le jet de tir (unités de tir)',h2))
s+=B(['<b>Points d’attaque</b> = attaque de l’unité × nombre de figurines restantes.',
 '<b>Dés</b> : un d10 par dizaine de points (chaque dé vaut 10 PV) + un dé pour le reste (il vaut le reste). Exemple : 23 points → 3 dés valant 10, 10 et 3.',
 '<b>Seuil</b> = 4 + modificateurs (§ 6). Chaque dé ≥ seuil touche.',
 '<b>Armure</b> : si la cible a une armure (A), le défenseur relance chaque dé qui touche ; chaque dé inférieur à A devient une blessure (de la valeur du dé touché). Sans armure, tous les dés qui touchent blessent. Magie (mag) : armure de la cible +1.',
 '<b>Pertes</b> : les blessures sont retirées des PV de l’unité, figurine par figurine en partant de la dernière ; une figurine à 0 PV est retirée. Unité composée : la partie la plus nombreuse tombe avant la figurine seule.',
 '<b>Relance du général</b> : un dé par tour pour une unité à portée (2 pour l’Empire), au choix du joueur, résultat conservé (Annexe C).'])
s.append(P('6. Modificateurs du seuil',h2))
s.append(box([['Modificateur','Valeur','Remarque'],
 ['Longue portée (au-delà de 3 hex)','+3','+1 pour une arme lourde (aL)'],
 ['Tir après déplacement','+3','sauf dep+t et cavalerie légère'],
 ['Tireur pris au corps à corps','+3','sauf tirailleurs'],
 ['Sans voir','+4','Annexe A'],
 ['Cible avec étendard','+1',''],
 ['Cible sur colline','+1','pas contre une unité volante en vol'],
 ['Cible dans ou derrière une forêt','+2',''],
 ['Cible dans une construction','+2','fortification (sauf vol), muret, autour d’un village, village à toit plat'],
 ['Cible à la sortie d’un pont','+2','le tir arrive par le pont ; pas pour un tireur en vol ou qui saute'],
 ['Cible : unité du général','+3',''],
 ['Cible prise à revers','−2','tir par un des 3 côtés arrière de la cible'],
 ['Cible en marche forcée','−2',''],
 ['Ordre du général « att »','−1','tireur à portée du général (6 hex, 9 Empire)'],
 ['Unité spéciale (spe)','−1',''],
 ['Bonus d’armée de terrain','−1','Elfes sylvains, Saurus, Skavens (Annexe D)'],
 ['Magie (mag)','armure +1','sur le jet d’armure de la cible'],
 ['Ajustement du MJ','libre','']],[62*mm,22*mm,90*mm]))
s.append(P('7. L’artillerie',h2))
s+=B(['<b>Le joueur indique le point maximal</b> du tir : une tuile à 10 hex au plus de la machine (portée maximale 10 hex = la tuile 3). Pas de portée minimale.',
 '<b>Les 3 tuiles</b> : les 3 tuiles consécutives du trajet qui finissent au point indiqué ; <b>1 = la plus proche de la machine</b>, 3 = le point indiqué.',
 'Chaque machine de l’unité lance son propre <b>d4</b> :',
 '&nbsp;&nbsp;– <b>1 à 3</b> : le projectile tombe sur la tuile 1, 2 ou 3 ;',
 '&nbsp;&nbsp;– <b>4</b> : on lance systématiquement un <b>nouveau d4</b>. Sur 1 à 3, l’artillerie touche la tuile correspondante <b>à condition que la machine voie le point visé</b> (règle de vision habituelle, Annexe A) ; sinon il ne se passe rien. Sur un nouveau <b>4 : incident de tir</b> : la machine perd elle-même ses propres points d’attaque.',
 '<b>Dégâts</b> : l’artillerie retire autant de PV qu’elle a de points d’attaque (15 pour un canon ou une catapulte, 20 pour un canon lourd ou un tank), en ignorant l’armure, à l’unité de la tuile touchée — <b>même si elle est amie</b> — ou à sa propre unité sur un incident.',
 '<b>Priorité</b> : s’il y a dans l’unité touchée une grande figurine, un monstre ou une autre pièce d’artillerie, les PV leur sont retirés en priorité (la figurine qui a le plus de PV) ; sinon la dernière figurine. Une seule figurine perd des PV par projectile.',
 '<b>Tuile vide</b> : aucun effet.',
 'Unité spéciale « canon » des Nains : une <b>relance supplémentaire</b> en cas d’incident (après le deuxième 4, un troisième d4 : 1 à 3 → tuile si la machine voit le point ; 4 → incident).'])
s.append(fig(FG.f_artillery))
s.append(P('8. Tir dans une mêlée',h2))
s+=B(['Tir sur une unité au corps à corps : chaque dé qui fait <b>1</b> touche l’unité <b>juste avant la cible sur la ligne de tir</b> (l’unité alliée engagée de ce côté) — <b>à confirmer</b>.',
 'Artillerie sur une mêlée (unités alliées engagées) : <b>à résoudre plus tard</b>.'])
s.append(P('9. Les tirailleurs',h2))
s+=B(['Pendant les déplacements et les tirs, ils sont devant l’unité protégée et ignorent le malus « pris au corps à corps ».',
 'S’ils ont été chargés : ils tirent sur l’unité qui les a chargés (portée courte, sans malus) ; c’est leur seul tir du tour. À la fin de la phase de tir, ils échangent leur place avec l’unité protégée (Annexe B § 9).',
 'L’unité protégée a +1 de sauvegarde au corps à corps seulement, pas au tir.'])
s.append(P('10. Fin de la phase : jets de fuite et débordement',h2))
s+=B(['<b>Jet de fuite</b> pour chaque unité passée à la moitié de ses figurines ou moins pendant la phase (sauf l’unité du général) : d10.',
 '&nbsp;&nbsp;– unité démoralisable : 1 à 7 → elle fuit (détruite) ;',
 '&nbsp;&nbsp;– unité indémoralisable (infanterie lourde ou d’élite, cavalerie lourde, monstres) : 1 → détruite ;',
 '&nbsp;&nbsp;– +1 si le général de l’armée est mort ; +1 face aux Morts-vivants (BA, peur).',
 '<b>Débordement</b> après un tir : <b>règle à traiter plus tard</b> (avec le corps à corps).'])
s.append(P('11. Points restant à traiter',h2))
s+=B(['Incident définitif de l’artillerie : nombre de points de vie perdus (et par qui : machine, servants).',
 'Tir dans une mêlée : l’unité juste avant la cible sur la ligne de tir reçoit les dés à 1 — à confirmer.',
 'Unités alliées dans une mêlée touchées par l’artillerie (« une figurine de la cible et une figurine alliée, un monstre en priorité ») : <b>à résoudre plus tard</b>.',
 'Sur un 4 suivi de 1 à 3 avec vision : j’ai compris que le projectile tombe sur la tuile du nouveau dé — à confirmer.',
 'Débordement (après un tir ou au corps à corps) : règles à venir.'])

def foot(c,d):
    c.saveState(); c.setFont('S',7.5); c.setFillColor(colors.HexColor('#8a8f98'))
    c.drawString(18*mm,10*mm,'Le tir'); c.drawRightString(A4[0]-18*mm,10*mm,'page %d'%d.page); c.restoreState()
doc=SimpleDocTemplate('/home/claude/p2/REGLES-TIR.pdf',pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=16*mm,bottomMargin=18*mm,title='Le tir',author='MJ')
doc.build(s,onFirstPage=foot,onLaterPages=foot)
