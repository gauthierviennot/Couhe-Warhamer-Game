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

s=[]
s.append(P('Le général',h1))
s.append(P('Règles complètes d’utilisation, validées par le MJ — 26/10/2026 (version 3)',sub))
s.append(P('1. Portée du général : 6 hex, 9 pour l’Empire',h2))
s+=B(['Toutes les règles ci-dessous parlent de la <b>portée du général</b> : la distance, en hexagones, entre la tuile de l’unité du général et celle d’une autre unité.',
 'Elle vaut <b>6 hexagones</b> pour toutes les armées.',
 '<b>Empire — général d’exception (bonus d’armée) :</b> elle vaut <b>9 hexagones</b>.',
 'C’est la portée de ses <b>pouvoirs</b>, pas une portée de déplacement : l’unité du général se déplace selon sa fiche, comme les autres.',
 'Elle se mesure au moment où le pouvoir sert (au tir : avec les positions après les déplacements).',
 '<b>Tous les avantages du général s’appliquent aussi à sa propre unité</b> (chevron, mvt +3, charge +2, att −1, relance).'])
s.append(box([['Pouvoir','Portée normale','Empire'],
 ['Chevron du premier placement','6 hex','9 hex'],
 ['mvt +3 (une unité désignée)','6 hex','9 hex'],
 ['charge +2 (une unité désignée)','6 hex','9 hex'],
 ['att −1 (toutes les unités)','6 hex','9 hex'],
 ['Relance d’un dé (unités à portée)','1 dé par tour','jusqu’à 2 dés par tour']],[70*mm,50*mm,50*mm]))
s.append(P('2. Désigner le général',h2))
s+=B(['Pendant le <b>dépôt des unités</b> (débarquement), chaque joueur affecte son général à l’une de ses unités posées : puce « Général » du sélecteur, puis toucher l’unité.',
 'Le général ne peut rejoindre qu’une unité de <b>plusieurs figurines</b>.',
 'Elle est marquée de trois chevrons noirs dans un rond jaune.',
 'Le général peut changer d’unité tant que le dépôt n’est pas terminé.',
 'Au dépôt, le général ne donne <b>aucun bonus</b> : les unités se posent sur les tuiles marquées de leur zone, sans tuile supplémentaire.'])
s.append(P('3. Le chevron du premier placement',h2))
s+=B(['Toujours pendant le dépôt, les unités à portée du général (6 hex, 9 pour l’Empire) reçoivent un chevron seul, gris. Le joueur en active <b>un seul</b> (il devient doré) en le touchant.',
 'Il peut être mis sur l’unité du général elle-même.',
 '<b>Effet :</b> au premier placement de la bataille, l’unité au chevron peut aller <b>3 tuiles plus loin</b> que sa portée normale. C’est valable en simulation de placement comme en jeu (tuiles au contour doré à l’appui long).',
 'Si l’unité au chevron ou celle du général est déplacée et sort de portée, le chevron est retiré.'])
s.append(P('4. Les pouvoirs aux tours suivants',h2))
s.append(P('À chaque pose des ordres, en plus des ordres de ses unités, le joueur peut donner <b>un seul</b> ordre du général. Il est caché à l’adversaire jusqu’à la révélation des ordres, et il reste modifiable jusqu’à « Valider mes ordres ». Il ne vaut que pour le tour.'))
s.append(P('Pouvoir A : mvt +3 ou charge +2, pour une seule unité',h3))
s+=B(['Le général désigne <b>une</b> unité à portée (6 hex, 9 pour l’Empire), la sienne comprise, en la touchant sur la carte (cercles dorés). Elle porte le chevron doré.',
 'Il peut changer d’unité à chaque tour (bouton « Changer d’unité », ou toucher le chevron).',
 '<b>mvt +3 :</b> 3 hexagones de plus, aussi bien en déplacement normal qu’en marche forcée (déplacement × 2, puis +3).',
 '<b>charge +2 :</b> sa charge porte à 7 hexagones au lieu de 5.',
 'La portée affichée à la pose de l’ordre en tient compte.'])
s.append(P('Pouvoir B : att −1, pour toutes les unités à portée',h3))
s+=B(['Toutes les unités du joueur à 6 hex ou moins du général (9 pour l’Empire), la sienne comprise, attaquent avec un seuil plus bas de 1 (par exemple 4 → 3).',
 '<b>Au tir :</b> la ligne « Ordre du général att −1 » est cochée d’office pour chaque tireur à portée, au moment du tir. Le MJ peut la corriger.',
 '<b>Au corps à corps :</b> même effet, à appliquer avec la phase de mêlée.'])
s.append(P('5. Relance de dés',h2))
s+=B(['Le général permet de relancer <b>un dé, au maximum une fois par tour</b>.',
 '<b>Quand :</b> c’est le joueur qui choisit, au moment où il obtient le résultat de ses dés et que ce résultat ne le satisfait pas.',
 '<b>Quels dés :</b> n’importe quel dé du joueur : dé d’attaque au tir ou au corps à corps, dé d’artillerie, dé d’armure, dé de jet de fuite.',
 '<b>Quelles unités :</b> seulement les unités couvertes par les pouvoirs du général, c’est-à-dire à 6 hex ou moins de lui (9 pour l’Empire), la sienne comprise.',
 '<b>Résultat :</b> le résultat de la relance est conservé, même s’il est plus défavorable.',
 '<b>Empire — général d’exception :</b> jusqu’à <b>2 dés</b> de relance par tour au lieu de 1. Il peut relancer deux fois le même dé (le second résultat est conservé).',
 'Plus de relance si l’unité du général est détruite.'])
s.append(P('<b>Dans le jeu :</b> pas encore codé. Le MJ relance à la main.',small))
s.append(P('6. L’unité du général au combat',h2))
s+=B(['<b>Artillerie :</b> l’unité du général l’ignore. Elle n’est jamais une cible d’artillerie.',
 '<b>Autres tirs :</b> malus de +3 pour le tireur qui la vise (modificateur « Cible : unité du général », coché d’office).',
 '<b>Jets de fuite :</b> l’unité du général n’en fait pas, même passée à la moitié de ses figurines.',
 '<b>Général mort :</b> si l’unité du général est détruite, toutes les unités de son armée ont <b>+1</b> à leurs jets de fuite (démoralisable : fuit sur 1 à 8 au lieu de 1 à 7 ; indémoralisable : sur 1 à 2 au lieu de 1).',
 '<b>Ses pouvoirs disparaissent</b> dès que son unité est détruite : plus d’ordre du général, plus de mvt +3, charge +2, att −1, ni de relance. Un pouvoir donné pour le tour en cours cesse immédiatement.'])
s.append(P('7. Récapitulatif',h2))
s.append(box([['Moment','Règle','Empire','Dans le jeu'],
 ['Dépôt','Général sur une unité de plusieurs figurines ; pas de bonus de dépôt','—','Codé'],
 ['Dépôt → 1er placement','Chevron sur une unité à portée (la sienne comprise) : +3 tuiles au premier placement','Portée 9 hex','Codé'],
 ['Pose des ordres','mvt +3 (déplacement ou marche forcée) ou charge +2 pour une unité désignée à portée, la sienne comprise','Portée 9 hex','Codé'],
 ['Pose des ordres','att −1 pour toutes les unités à portée','Portée 9 hex','Codé au tir ; mêlée à venir'],
 ['Tous les dés','Relance d’1 dé (attaque, artillerie, armure, fuite), une fois par tour, unités à portée ; résultat conservé','Jusqu’à 2 dés, même dé possible','À faire'],
 ['Tirs','Ignore l’artillerie ; +3 au tireur qui la vise','—','Codé'],
 ['Fuite','Pas de jet de fuite ; mort du général : +1 aux jets de son armée','—','Codé'],
 ['Mort du général','Tous ses pouvoirs disparaissent','—','Codé (relance : à faire)']],
 [32*mm,78*mm,24*mm,40*mm]))
def foot(c,d):
    c.saveState(); c.setFont('S',7.5); c.setFillColor(colors.HexColor('#8a8f98'))
    c.drawString(18*mm,10*mm,'Le général — règles du jeu'); c.drawRightString(A4[0]-18*mm,10*mm,'page %d'%d.page); c.restoreState()
doc=SimpleDocTemplate('/home/claude/p2/REGLES-GENERAL.pdf',pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=16*mm,bottomMargin=18*mm,title='Le général',author='MJ')
doc.build(s,onFirstPage=foot,onLaterPages=foot)
