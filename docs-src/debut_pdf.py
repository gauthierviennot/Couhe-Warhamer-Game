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
s.append(P('Du début de partie à la charge',h1))
s.append(P('Règle complète (version 2), d’après les règles validées par le MJ et le jeu — 26/10/2026. Documents de détail : REGLE-VISION, REGLES-CHARGE, REGLES-GENERAL, REGLES-BONUS-ARMEE.',sub))

s.append(P('1. Vue d’ensemble',h2))
s.append(box([['Moment','Ce qui se passe'],
 ['Préparation (MJ)','Carte, terrains, zones de débarquement, équipes, armées et légions'],
 ['Débarquement','Choix des zones, dépôt des unités sur les tuiles marquées, étendards, général, chevron'],
 ['1er tour : placement','Chaque unité quitte sa tuile de dépôt et se place, secteur par secteur, à tour de rôle'],
 ['Tours suivants','1. pose des ordres et ordre du général → 2. révélation → 3. charges → 4. autres déplacements → 5. tirs → 6. corps à corps']],[42*mm,132*mm]))
s.append(P('Qui joue quoi',h3))
s+=B(['<b>Chaque joueur ne gère que ses propres unités</b> : celles de sa légion et les mercenaires que le MJ lui a attribués. Il ne peut ni placer, ni donner d’ordre, ni déplacer, ni faire tirer une unité d’un autre joueur, même de son équipe.',
 '<b>Les dés sont lancés par les joueurs</b> : le joueur concerné appuie sur « Jeter les dés » (l’outil tire et calcule). Le tir s’ouvre dans une <b>fenêtre de résolution</b> qui montre la cible, les modificateurs et le bouton « Jeter les dés ».',
 '<b>Tous les joueurs voient les jets de dés</b> : en grand pour les joueurs concernés, en miniature pour les autres.',
 '<b>Étiquettes des unités</b> : seulement le <b>sigle</b> de la fiche (il, tmv…) et un <b>numéro unique</b> pour chaque joueur, jamais le nom de l’unité ; deux touchers sur l’étiquette ouvrent la fiche de l’armée ou de la légion, avec le nom.',
 'Les fenêtres sur la carte (résultats, tirs, dés) s’ouvrent <b>le plus loin possible de la zone de combat</b> ; on peut les déplacer et les fermer.',
 '<b>Mode « test et correction » du MJ</b> : le MJ peut agir pour tous les joueurs, lui compris, et c’est lui qui lance les dés. À la sortie de ce mode, il choisit de <b>conserver l’état</b> obtenu ou de <b>revenir à l’état</b> du moment où il l’a activé.',
 '<b>Le mode test vaut pour toutes les phases</b> (choix des zones, dépôt, placement, ordres, déplacements, tirs). Le MJ choisit le joueur qu’il incarne (ou « MJ arbitre », qui voit tout) : il voit alors le jeu comme ce joueur, et un <b>bandeau en haut de la carte</b> indique en permanence le joueur joué.'])

s.append(P('2. Préparation',h2))
s+=B(['La carte (hexagones) : terrains (plaine, colline, montagne, route, eau, marais) et décors (forêt, pont, fortification, demi-fortification, village, village à toit plat, muret). <b>Les joueurs participent à l’élaboration de la carte</b> (terrains et décors), <b>sauf les marqueurs</b> (zones de débarquement, frontières, marqueurs +), réservés au MJ. Le terrain est figé pendant la bataille dès qu’un joueur a validé ses ordres (§ 5).',
 'Le MJ marque les <b>zones de débarquement</b> (losanges sur au moins 2 tuiles voisines ; triangles aux extrémités), les répartit en deux groupes et attribue chaque groupe à une équipe. Les <b>frontières</b> (disques, triangles hors zone) ne se franchissent pas au placement. Les <b>marqueurs +</b> délimitent les aires de bonus des sections de débarquement. <b>Une fois le placement de bataille terminé</b>, les disques et les marqueurs + ne sont plus affichés (ils restent enregistrés : ils réapparaissent si l’on revient au placement) ; les <b>triangles restent</b>, ils serviront à compter les points forts.',
 'Chaque joueur reçoit une armée et une légion (fiches d’armée). Une ligne de fiche donne : attaque, PV, armure, déplacement (dep), portée, mobilité (marche, vol, vol stationnaire, saut) et capacités entre parenthèses (aL, art, BA, ber, C, G, jump, mag, spe, T, v, vs, 2att…).'])
s.append(P('Terrains',h3))
s.append(box([['Terrain','Déplacement','Sauvegarde (cible)','Autres effets'],
 ['Colline','—','+1 (sauf vol)','Niveau 1 pour la vision'],
 ['Forêt','−1 (sauf vol ; en charge : compte comme une tuile)','+2 (dans ou derrière)','Annule la charge de cavalerie (C) ; cache l’unité qui s’y trouve'],
 ['Fortification','cavalerie interdite','+2 (sauf vol)','Niveau +1, vue à 360°, annule C'],
 ['Marais','−1 (sauf vol ; en charge : compte comme une tuile)','—','—'],
 ['Montagne','infranchissable (sauf vol, saut), pas d’arrêt','—','Bloque toujours la vue'],
 ['Muret','—','+2','Annule C'],
 ['Pont','passage de la rivière, seulement d’une extrémité à l’autre (tuile orientée)','+2 (tir et corps à corps), cible à la sortie du pont','Annule C'],
 ['Rivière','infranchissable sauf pont, vol, saut, Saurus (BA)','—','Saurus (BA) peuvent s’y arrêter'],
 ['Route','+2 si on y termine (sauf vol ; pas en charge)','—','—'],
 ['Village','on ne s’y tient pas (sauf toit plat) ; toit plat interdit à la cavalerie','+2 autour des maisons et sur toit plat','Annule C ; toit plat : niveau +1, vue à 360°']],[24*mm,48*mm,44*mm,58*mm]))
s.append(P('Une unité volante en vol n’a ni malus ni protection par les hauteurs (colline, fortification) et attaque un pont sans malus ; une unité qui saute attaque une fortification et un pont sans malus.',small))

s.append(P('3. Débarquement',h2))
s+=B(['Chaque joueur choisit une zone de débarquement de son groupe.',
 '<b>Dépôt :</b> le joueur pose ses unités une par une, <b>uniquement sur les tuiles marquées</b> de sa zone (plusieurs unités peuvent partager une tuile de dépôt). Aucun bonus de déplacement au dépôt.',
 '<b>Étendards :</b> le joueur les attribue à ses unités, dans la limite de sa fiche (cible avec étendard : sauvegarde +1, au tir comme au corps à corps).',
 '<b>Général :</b> il rejoint une unité posée de <b>plusieurs figurines</b> (trois chevrons noirs dans un rond jaune).',
 '<b>Mercenaires :</b> le MJ peut attribuer à un joueur des mercenaires, pris dans l’<b>infanterie légère</b> d’une légion libre. Ils sont gérés par ce joueur, sans <b>bonus d’armée</b> et <b>sans étendard</b> ; ils profitent des pouvoirs du général comme ses autres unités.',
 '<b>Chevron :</b> une seule unité à portée du général (6 hex, 9 pour l’Empire), la sienne comprise, reçoit le chevron doré : elle ira 3 tuiles plus loin au premier placement.',
 '<b>Simulation de placement :</b> chaque joueur peut essayer ses placements sur une carte virtuelle, avec les mêmes portées qu’au premier tour.',
 'Le MJ ferme le dépôt. Les unités non déposées ne participent pas à la bataille (un avertissement le rappelle).'])

s.append(P('4. Premier tour : le placement',h2))
s+=B(['Ce tour est un <b>placement</b>, pas un déplacement : les coûts de terrain ne comptent pas.',
 '<b>Secteurs :</b> deux sections de débarquement forment un même secteur quand les camps se font face (tuiles ou aires de bonus qui se touchent, ou qui bordent une même frontière). Dans un secteur disputé, un <b>d10</b> par équipe désigne celle qui place en premier, puis les équipes placent <b>une unité à tour de rôle</b>. Les secteurs séparés placent en même temps, sans dé.',
 '<b>Portée de placement :</b> en partant de la tuile de dépôt, qui compte pour 1 : dep − 1 tuiles autour d’elle ; plus le <b>bonus de section</b>, fixé par le MJ pour chaque section de débarquement (2 par défaut), seulement dans l’<b>aire de bonus</b> de la section ; plus <b>3 tuiles</b> pour l’unité au chevron.',
 'On ne franchit pas une frontière. <b>Les obstacles entre la tuile de dépôt et la tuile d’arrivée ne comptent pas</b> (eau, montagne, orientation des ponts, unités) : seule la <b>tuile d’arrivée</b> doit être permise pour l’unité et son armée. On ne s’arrête ni sur une montagne, ni sur l’eau (sauf pont et Saurus BA), <b>ni dans un village simple</b> (toutes les unités, volantes comprises ; le village à toit plat est permis). La <b>cavalerie</b> ne monte ni sur une fortification ou une demi-fortification, ni sur un village à toit plat (au placement comme dans tous les déplacements et toutes les charges). <b>Pas de zone d’interdiction au placement</b> : une unité peut être placée au contact d’un adversaire.',
 '<b>Une seule unité par tuile</b> à la fin du placement, tuiles de dépôt comprises : une unité peut rester sur sa tuile de dépôt seulement si aucune autre unité placée n’y reste. Le passage aux ordres est refusé tant qu’une tuile porte plusieurs unités.',
 'Le joueur choisit l’<b>orientation</b> puis valide : une unité validée ne bouge plus. Repositionnée avant validation, elle garde l’orientation choisie.',
 'Le placement de bataille se termine quand toutes les unités déposées sont placées ; le MJ passe aux ordres.'])

s.append(P('5. Tours suivants : la pose des ordres',h2))
s+=B(['Chaque joueur donne un ordre à <b>chacune</b> de ses unités sur le plateau, par un <b>appui long sur l’unité</b> (pas d’ordre groupé). Une unité qui ne veut rien faire reçoit un ordre de déplacement, qu’elle pourra ne pas exécuter.',
 'Son équipe voit ses ordres ; l’adversaire voit seulement qu’un ordre est donné (✉).',
 'Les ordres restent modifiables jusqu’à « Valider mes ordres ». <b>Le terrain est figé</b> dès qu’un joueur a validé, puis pendant les déplacements et les tirs du tour.'])
s.append(box([['Ordre','Qui','Effet'],
 ['Charge','unités avec attaque de corps à corps','Cible adverse désignée sur la carte, à distance de charge (5 tuiles, 7 avec charge +2) par le chemin autorisé (REGLES-CHARGE)'],
 ['Tir court / tir long','unités avec attaque de tir','3 hex / 7 hex (longue portée +3, +1 pour aL) ; cible choisie au moment du tir'],
 ['Tir d’artillerie','artillerie','10 hex, d4 ; seul ordre de tir de l’artillerie'],
 ['Déplacement','toutes','Jusqu’à dep tuiles, trajet réel ; tir possible avec malus +3 (sauf dep+t), sans ordre de tir'],
 ['Marche forcée','toutes','dep × 2 ; aucune attaque ; l’adversaire qui l’attaque a −2'],
 ['Tirailleur','unités T','Sur la tuile juste devant une unité alliée de corps à corps ou mixte qui la regarde, même orientation (REGLES-CHARGE § 9)']],[30*mm,44*mm,100*mm]))
s.append(Spacer(1,4))
s+=B(['<b>Unité volante (v, vs) :</b> à chaque ordre, « en vol » (par défaut) ou « au sol », pour tout le tour (vision, déplacement, combat). Ce choix est caché à l’adversaire.',
 '<b>Ordre du général</b> (un seul, pour le tour ; visible des joueurs de son équipe, caché à l’adversaire jusqu’à la révélation) : <b>mvt +3</b> (déplacement ou marche forcée) ou <b>charge +2</b> pour une unité désignée à portée, la sienne comprise ; ou <b>att −1</b> pour toutes les unités à portée. Portée 6 hex, 9 pour l’Empire. Plus de pouvoir si l’unité du général est détruite (REGLES-GENERAL).',
 'L’unité qui reçoit <b>mvt +3</b> ou <b>charge +2</b> se désigne en <b>touchant son chevron</b> (sur la carte), ou par « Changer d’unité » dans le panneau ; on peut en changer jusqu’à la validation des ordres.',
 '<b>Charge :</b> sur la carte, une <b>flèche rouge</b> va de l’unité qui charge vers sa cible (ligne de vue), et le <b>cheminement prévu</b> à ce moment s’affiche en pointillés jusqu’à la tuile de contact (rond blanc). Pour un déplacement ou une marche forcée, le cheminement prévu jusqu’à la destination s’affiche de la même façon. Le joueur voit tout de suite l’indication de prise à revers, de vision et les marqueurs de sauvegarde de la cible.',
 '<b>Portée réelle :</b> pour un déplacement ou une marche forcée, la carte montre les tuiles atteignables (trajet, terrain, obstacles).'])

s.append(P('6. La révélation des ordres',h2))
s+=B(['Quand tous ont validé (ou sur décision du MJ), les ordres sont révélés à tous.',
 'Sont alors <b>fixés</b> pour tout le tour : le succès de chaque charge, sa vision (sans voir ou non), la prise à revers, les vrais choix « en vol / au sol », la redirection des charges vers les tirailleurs.',
 'Les charges sont obligatoires.'])

s.append(P('7. Déplacements : les charges',h2))
s+=B(['Toutes les charges sont jouées d’abord, dans une seule file, <b>de la plus courte à la plus longue</b> (vrai trajet) ; égalité : d10.',
 'Trajet : chaque tuile compte pour 1 ; en charge, forêt et marais n’ont pas de modificateur de déplacement (ils comptent comme une tuile) ; on ne traverse aucune unité (sauf vol en vol et saut ; on peut passer sous une unité volante en vol) ; sans chemin libre à la révélation, la charge traverse et devient sans voir.',
 'Arrivée : au contact, sur la <b>facette de la charge</b> (la plus proche, puis les autres facettes de la charge, puis étalement en surnombre) ; toutes prises : <b>deuxième rideau</b> (soutien sans combat).',
 'Charges mutuelles : toujours au contact ; le décor au plus fort modificateur fixe la ligne de front, sinon au milieu.',
 '<b>Unité déjà chargée</b> par une charge jouée avant : sa charge simple n’a pas lieu (elle reste en place) ; dans une charge mutuelle, l’autre unité fait tout le trajet jusqu’à son contact.',
 '<b>Film des charges et des déplacements</b> : pendant les déplacements, le bouton « Film des charges et des déplacements » remet les unités à leur <b>position d’origine</b> (avant les charges) et rejoue <b>image par image</b> toutes les charges puis tous les déplacements joués : une image = <b>un pas d’une tuile</b> (les deux unités d’une charge mutuelle avancent ensemble), une image pour les <b>jets de dés</b> rejoués à l’écran (départage, charge mutuelle, pont), une image pour l’arrivée et l’orientation. Boutons : début, bloc précédent, image précédente, lecture / pause, image suivante, bloc suivant, fin ; on peut s’arrêter sur chaque image et vérifier chaque trajet (en jaune sur la carte, tuiles numérotées). Fermer la fenêtre rend la carte réelle.',
 '<b>Chaque charge résolue est montrée à tous</b> : on voit l’unité avancer tuile par tuile jusqu’au front, une charge après l’autre. Quand une seule tuile d’arrivée est possible, la charge se résout d’elle-même ; sinon le joueur choisit la tuile.',
 'Détail complet : REGLES-CHARGE.'])

s.append(P('8. Déplacements : les autres unités',h2))
s+=B(['Après les charges, un <b>d10</b> par équipe (nouveau à chaque tour) désigne l’équipe qui commence ; puis les équipes déplacent leurs unités à tour de rôle.',
 '<b>Pont</b> (tuile orientée) : une unité au sol n’y entre et n’en sort que par ses deux extrémités, d’une rive à l’autre, jamais par le côté (en déplacement comme en charge).',
 'Trajet réel : coût 1 par tuile ; forêt et marais −1 (sauf vol ; pas de surcoût en forêt pour les Elfes sylvains BA) ; route +2 si on y termine (sauf vol) ; montagne et eau selon le tableau des terrains ; une unité adverse barre le passage (sauf vol en vol et saut) ; une unité au sol peut passer sous une unité volante en vol, sans s’arrêter sur sa tuile ; la cavalerie ne monte pas sur une fortification.',
 '<b>Zone d’interdiction :</b> on ne s’arrête pas au contact d’un adversaire, sauf en charge, ou s’il y a une différence de hauteur entre les deux unités (colline, fortification, village à toit plat).',
 'Une unité avec un ordre de déplacement peut ne pas bouger.',
 '<b>Capacité de déplacement d’une unité</b> (amie ou adverse) : un appui long sur elle montre les tuiles qu’elle peut atteindre <b>depuis sa position actuelle</b> (jamais la portée du tour de placement) ; le choix secret « en vol / au sol » d’une unité adverse n’est pas révélé.'])

s.append(P('Modificateurs de la cible (tir et corps à corps)',h3))
s.append(box([['Modificateur','Valeur'],
 ['Étendard, colline (sauf vol)','+1'],
 ['Constructions : fortification, muret, autour d’un village, sortie de pont ; forêt (dans ou derrière)','+2'],
 ['Unité du général (tir seulement)','+3'],
 ['Sans voir','+4'],
 ['Cible prise à revers, cible en marche forcée','−2 pour qui l’attaque'],
 ['Protégée par des tirailleurs','+1, corps à corps seulement']],[130*mm,44*mm]))
s.append(P('9. Vision (résumé)',h2))
s+=B(['Trait de centre à centre ; <b>toute tuile touchée par le trait compte, même par un coin</b> (une montagne frôlée bloque) ; niveaux : colline 1, fortification ou village à toit plat +1 ; forêt et village simple sont des obstacles à leur niveau ; montagne bloque toujours.',
 'Une unité au sol sur le trait bloque à même niveau ; grandes tailles et unités volantes voient et sont vues par-dessus les unités ; en vol, par-dessus tout sauf les montagnes.',
 'Agir vers l’arrière (3 côtés arrière) : sans voir, sauf vue à 360° sur fortification ou village à toit plat. Unité dans une forêt : toujours cachée, mais elle voit.',
 'Charges : vision fixée à la révélation. Tirs : vision au moment du tir. Détail : REGLE-VISION.'])
def foot(c,d):
    c.saveState(); c.setFont('S',7.5); c.setFillColor(colors.HexColor('#8a8f98'))
    c.drawString(18*mm,10*mm,'Du début de partie à la charge'); c.drawRightString(A4[0]-18*mm,10*mm,'page %d'%d.page); c.restoreState()
doc=SimpleDocTemplate('/home/claude/p2/REGLES-DEBUT-A-CHARGE.pdf',pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=16*mm,bottomMargin=18*mm,title='Du début de partie à la charge',author='MJ')
doc.build(s,onFirstPage=foot,onLaterPages=foot)
