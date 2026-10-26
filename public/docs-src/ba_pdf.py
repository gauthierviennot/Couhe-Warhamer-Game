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
s.append(P('Bonus d’armée (BA)',h1))
s.append(P('Règles complètes, telles que lues dans les fiches et appliquées dans le jeu — 26/10/2026',sub))
s.append(P('1. Principe général',h2))
s+=B([
 'Un bonus d’armée ne s’applique qu’aux unités dont le nom porte <b>« BA »</b> entre parenthèses dans la fiche, par exemple « inf legere (BA) » ou « baliste (aL,BA) ». Une unité de la même armée sans cette mention n’en bénéficie pas.',
 'Exception : quand la fiche décrit un bonus d’armée sans marquer d’unités (Empire, Gobelins, Nains), il vaut pour l’armée entière ou pour le type d’unités qu’il nomme.',
 '« Attaque −1 » veut dire que le seuil pour toucher baisse de 1 (par exemple 4 → 3). C’est le même sens que l’ordre du général « att −1 ».',
 'Les bonus de terrain « à 3 hex autour » se mesurent depuis la tuile de l’unité : elle en bénéficie si elle est sur une tuile du terrain nommé, ou à 3 hexagones ou moins de l’une d’elles.'])
s.append(P('2. Bonus de terrain : attaque −1 près d’un terrain',h2))
s.append(P('Trois armées ont un bonus d’attaque lié à un terrain. Le fonctionnement est le même pour les trois :'))
s.append(box([['Armée','Terrain','Condition'],
 ['Elfes sylvains','Forêt','Unité BA dans une forêt ou à 3 hex ou moins d’une forêt'],
 ['Saurus','Rivière (eau ; un pont compte comme rivière)','Unité BA dans la rivière ou à 3 hex ou moins'],
 ['Skavens','Village (simple ou à toit plat)','Unité BA à 3 hex ou moins d’un village']],[32*mm,55*mm,88*mm]))
s.append(Spacer(1,4))
s+=B(['<b>Au tir :</b> la ligne « Bonus d’armée (terrain à 3 hex ou moins) −1 » apparaît dans les modificateurs de tout tireur BA de ces armées. Elle est <b>cochée d’office</b> quand la condition est remplie, décochée sinon. Le MJ peut la cocher ou la décocher.',
 'Seule la position du <b>tireur</b> compte, pas celle de la cible.',
 'Pas pour l’artillerie à d4 (elle n’a pas de seuil de tir) ; les armes lourdes (aL) BA, elles, en bénéficient.',
 '<b>Au corps à corps :</b> même règle, à appliquer avec la phase de mêlée (pas encore automatisée).'])
s.append(P('3. Les armées une par une',h2))
s+=army('Elfes sylvains',"bonus d’armée (BA) : attaque −1 en forêt (et à 3 hex autour) ; pas de malus de déplacement en forêt",
 'inf legere, caval lourde, caval legere, mage, archer lourd, champion sur dragon, homme arbre (toutes les unités de la fiche).',
 ['Attaque −1 dans une forêt ou à 3 hex ou moins (voir § 2).',
  '<b>Déplacement :</b> la forêt ne coûte pas de tuile supplémentaire (au lieu de +1), en déplacement comme en marche forcée.',
  'Charge : rien de plus, la forêt ne coûte déjà rien à personne en charge.',
  'Placement de début de bataille : pas d’effet, la portée de placement ne tient pas compte du terrain.'],
 'codé (forêt gratuite, modificateur de tir).')
s+=army('Saurus',"bonus d’armée (BA) : attaque −1 dans rivière (et à 3 hex autour), traverse rivière",
 'inf lourde, inf legere, tirailleur, caval lourde, mage volant, mage, archer, champion sur mégalodon, champion sur t-rex, mage sur tricératops, tricératops, ptérodactyle, croxigore, baliste, servant.',
 ['Attaque −1 dans une rivière ou à 3 hex ou moins (voir § 2).',
  '<b>Traverse rivière :</b> l’unité passe sur l’eau sans pont et peut s’y arrêter, en déplacement, en marche forcée, en charge (et charge mutuelle), au dépôt et au placement.',
  'Vision : une unité sur l’eau est au niveau 0 ; l’eau ne bloque jamais la vue.'],
 'codé (nage, modificateur de tir). Un Saurus sans BA ne peut plus aller sur l’eau.')
s+=army('Skavens',"bonus d’armée (BA) : attaque −1 dans village (3 hex autour)",
 'inf lourde, inf legere, rat-ogre, roue, autel de guerre, arme lourde, servant (pas le canon).',
 ['Attaque −1 à 3 hex ou moins d’un village (voir § 2). Une unité ne se tient jamais dans un village simple, seulement à côté ; elle peut être sur un village à toit plat.',
  'Aucun effet sur le déplacement, le placement ou la charge.'],
 'codé (modificateur de tir).')
s+=army('Empire',"bonus d’armée : général d’exception — portée : unités à 9 hex (au lieu de 6) ; 2 relances de dés d’attaque (au lieu de 1)",
 '', ['Toute l’armée (pas de marque BA).',
  '<b>Portée des pouvoirs du général : 9 hex au lieu de 6.</b> Ce n’est pas une portée de déplacement : l’unité du général se déplace selon sa fiche. Les 9 hex servent à :',
  '&nbsp;&nbsp;– chevron du premier placement : l’unité désignée doit être à 9 hex ou moins (elle garde ses +3 tuiles) ;',
  '&nbsp;&nbsp;– mvt +3 ou charge +2 : l’unité désignée doit être à 9 hex ou moins ;',
  '&nbsp;&nbsp;– att −1 : toutes les unités à 9 hex ou moins.',
  '<b>2 relances de dés d’attaque au lieu de 1.</b>'],
 'portée de 9 hex codée ; les relances ne sont pas encore codées (le jeu n’a pas encore de relance du général).')
s+=army('Morts-vivants',"bonus d’armée (BA) : peur = jet de fuite adversaire +1",
 'inf lourde, inf legere, caval lourde, caval legere, char, mage sur dragon, archer, autel de guerre, servant.',
 ['L’adversaire qui fait un jet de fuite face à une unité BA des Morts-vivants ajoute +1 à son jet.',
  'Aucun effet sur le déplacement, le placement ou la charge.'],
 'pas encore codé (il faudra savoir quelle unité a causé le jet de fuite) ; le MJ l’applique à la main.')
s+=army('Gobelins',"bonus d’armée : infanterie rapide",'',
 ['Toute l’infanterie gobeline a un déplacement plus grand (infanterie légère à 4 au lieu de 3).'],
 'rien à coder : déjà dans les valeurs de déplacement des fiches.')
s+=army('Nains',"bonus d’armée : infanterie légère avec armure lourde, infanterie d’élite berserk (ber)",'',
 ['Infanterie légère : armure lourde (valeur d’armure de l’infanterie lourde).',
  'Infanterie d’élite : berserk, règle de corps à corps.'],
 'armure déjà dans les fiches ; berserk avec la phase de mêlée.')
s.append(P('4. Récapitulatif',h2))
s.append(box([['Armée','Déplacement / charge','Placement','Tir','Corps à corps','État'],
 ['Elfes sylvains','Forêt gratuite','—','−1 près forêt','−1 près forêt','Codé (mêlée à venir)'],
 ['Saurus','Passe et s’arrête sur l’eau','Sur l’eau','−1 près rivière','−1 près rivière','Codé (mêlée à venir)'],
 ['Skavens','—','—','−1 près village','−1 près village','Codé (mêlée à venir)'],
 ['Empire','Pouvoirs du général à 9 hex','Chevron à 9 hex','att −1 à 9 hex ; 2 relances','2 relances','9 hex codé ; relances à faire'],
 ['Morts-vivants','—','—','Jet de fuite adverse +1','Jet de fuite adverse +1','À faire'],
 ['Gobelins','Infanterie rapide','—','—','—','Dans les fiches'],
 ['Nains','—','—','—','Armure lourde, berserk','Fiches / mêlée']],
 [24*mm,36*mm,22*mm,32*mm,30*mm,31*mm]))
s.append(Spacer(1,6))
s.append(P('Les autres armées (Alliance, Bretonnie, Chaos, Elfes noirs, Fédération, Hauts elfes, Ispanie, Nécrons, Orcs, Thyranides) n’ont pas de bonus d’armée dans leurs fiches ; leurs notes décrivent des unités spéciales (spe) ou des règles d’unités, qui ne sont pas des BA.',small))
def foot(c,d):
    c.saveState(); c.setFont('S',7.5); c.setFillColor(colors.HexColor('#8a8f98'))
    c.drawString(18*mm,10*mm,'Bonus d’armée — règles du jeu'); c.drawRightString(A4[0]-18*mm,10*mm,'page %d'%d.page); c.restoreState()
doc=SimpleDocTemplate('/home/claude/p2/REGLES-BONUS-ARMEE.pdf',pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=16*mm,bottomMargin=18*mm,title='Bonus d’armée',author='MJ')
doc.build(s,onFirstPage=foot,onLaterPages=foot)
