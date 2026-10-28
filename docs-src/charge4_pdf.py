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
s.append(P('La charge',h1))
s.append(P('Règle complète, validée par le MJ — 26/10/2026 (version 14)',sub))
s.append(P('1. Vue d’ensemble',h2))
s+=B(['Un tour se joue ainsi : <b>pose des ordres</b> (cachés à l’adversaire) → <b>révélation des ordres</b> → <b>charges</b> → autres déplacements → tirs → <b>corps à corps</b>.',
 'La charge se décide en trois temps : le joueur la <b>pose</b> (§ 3) ; à la <b>révélation des ordres</b>, son succès et sa vision sont <b>fixés</b> (§ 4) ; elle est ensuite <b>jouée</b> dans la file des charges (§ 5 à 8). Les tirailleurs ont leurs règles propres (§ 9). Les effets de la charge comptent au <b>corps à corps</b> (§ 10 à 12).',
 '<b>Chemin autorisé :</b> le trajet que l’unité qui charge a le droit de suivre (§ 6). Les distances de charge se mesurent toujours sur ce chemin, en tuiles, jusqu’à une tuile au contact de la cible.'])
s.append(P('2. Qui peut charger',h2))
s+=B(['Seules les unités qui ont une <b>attaque de corps à corps</b> dans leur fiche (unités de corps à corps ou mixtes).',
 'Une unité ne reçoit qu’un ordre par tour : jamais charge et tir à la fois.',
 '<b>Portée : 5 tuiles</b> par le chemin autorisé jusqu’au contact de la cible. <b>7</b> pour l’unité désignée par le général avec « charge +2 » (sa propre unité comprise ; portée du général 6 hex, 9 pour l’Empire ; aucun bonus si l’unité du général est détruite).',
 'Une unité volante (v, vs) choisit en plus « en vol » (par défaut) ou « au sol », pour tout le tour.'])
s.append(P('3. Poser l’ordre',h2))
s+=B(['Appui long sur l’unité, choix « Charge » : les cibles possibles s’entourent de rouge. Toucher la cible pose l’ordre.',
 '<b>Cible possible :</b> une unité adverse à distance de charge par le chemin autorisé, avec les positions du moment. <b>S’il n’y a aucune unité adverse à distance de charge, l’ordre de charge est refusé.</b>',
 'Le joueur voit tout de suite, à titre d’indication : la <b>prise à revers</b> (flèche « retour ») et la <b>vision</b> (œil, ou œil barré : sans voir, avec la raison). Une unité volante adverse est alors supposée en vol.',
 'Son équipe voit l’ordre ; l’adversaire voit seulement qu’un ordre est donné.',
 'L’ordre reste modifiable jusqu’à « Valider mes ordres ».'])
s.append(P('4. À la révélation des ordres : tout est fixé',h2))
s.append(P('<b>La vision et le succès d’une charge se décident au moment où les ordres sont révélés</b>, avec les positions de ce moment et les vrais choix « en vol / au sol ». L’ordre dans lequel les charges sont ensuite jouées n’y change rien.'))
s+=B(['<b>Charge obligatoire :</b> l’unité qui a reçu l’ordre de charge doit charger. Seul le MJ peut annuler une charge, pour corriger une erreur.',
 '<b>Succès :</b> la charge réussit si la cible est à distance de charge par le chemin autorisé. Sinon elle <b>échoue</b> : l’unité avance quand même <b>au maximum de sa capacité de charge</b> vers sa cible, sans contact (à confirmer plus tard : capacité de charge, ou capacité de déplacement maximale de l’unité).',
 'Ces échecs ne devraient pas arriver en jeu : la cible est choisie à la pose de l’ordre parmi les unités à distance de charge, et rien ne bouge avant la révélation. <b>Le terrain est figé</b> dès qu’un joueur a validé ses ordres, puis pendant les déplacements et les tirs du tour : le MJ ne peut plus le modifier.',
 '<b>Vision :</b> règle de vision (document REGLE-VISION) : trait de centre à centre, niveaux, abris, forêts, unités sur le trait, grandes tailles et unités volantes, montagne. En particulier :',
 '&nbsp;&nbsp;– <b>dans son dos :</b> si le trait part par l’un des 3 côtés arrière de l’unité qui charge, elle charge sans voir (sauf sur fortification, demi-fortification ou village à toit plat : vue à 360°) ;',
 '&nbsp;&nbsp;– cible dans une forêt (au sol, grande taille ou volante au sol) : sans voir ;',
 '&nbsp;&nbsp;– <b>pas de chemin libre</b> : l’unité devra traverser des unités (§ 6) : sans voir.',
 '<b>Prise à revers :</b> trait du centre de la cible au centre de l’unité qui charge ; s’il sort de l’hexagone de la cible par l’un de ses 3 côtés arrière, la cible est prise à revers. Passage exact par le sommet entre un côté avant et un côté arrière : avant.'])
s.append(P('5. Ordre des charges',h2))
s+=B(['Les charges sont jouées <b>avant tous les autres déplacements</b>, dans une seule file, <b>de la plus courte à la plus longue</b> (tuiles sur le vrai trajet jusqu’au contact).',
 '<b>Égalité de distance :</b> un d10 par charge (relancé en cas d’égalité) ; la plus haute part en premier.',
 'Une charge mutuelle (§ 8) n’occupe qu’une place dans la file. Les charges échouées sont jouées aussi (l’unité avance au maximum, § 4).',
 'À son tour, le joueur de l’unité (ou le MJ) choisit la tuile d’arrivée parmi les tuiles vertes proposées.',
 '<b>Unité déjà chargée :</b> une unité qui a déjà été chargée par une charge jouée avant la sienne (charge arrivée à son contact, ou charge mutuelle) est prise au corps à corps : <b>sa propre charge simple n’a pas lieu</b>, elle reste en place.'])
s.append(P('6. Le chemin autorisé',h2))
s+=B(['Chaque tuile compte pour 1. En charge, <b>forêt et marais n’ont pas de modificateur de déplacement</b> : ils comptent comme une tuile ; la route ne donne pas de bonus.',
 '<b>Unités au sol, grandes tailles, unités volantes au sol :</b> elles ne traversent <b>aucune unité, amie ou ennemie</b> ; elles contournent, par le chemin le plus court. S’il n’existe aucun chemin libre, elles traversent les unités sur leur passage (charge sans voir, fixée à la révélation).',
 '<b>Sous une unité volante en vol :</b> une unité au sol peut passer sous une unité volante en vol (amie ou ennemie), mais ne peut pas s’arrêter sur sa tuile.',
 '<b>Unités volantes en vol et unités qui sautent :</b> elles passent au-dessus des unités (sans gain de vision pour celles qui sautent).',
 '<b>Montagnes :</b> survolées en vol, franchies en saut ; infranchissables pour les autres.',
 '<b>Pont :</b> le pont est une tuile <b>orientée</b> qui relie les deux rives. Une unité au sol n’y entre et n’en sort que par ses <b>deux extrémités</b>, d’une rive à l’autre ; jamais par le côté (depuis la rive ou depuis l’eau).',
 '<b>Fortification :</b> on y entre et on en sort seulement par sa <b>porte</b> (fortification à une entrée : une porte ; à deux entrées : deux portes opposées), sauf unités volantes en vol et unités qui sautent — comme un pont.',
 '<b>Eau :</b> seulement par un pont, sauf unités volantes en vol, unités qui sautent (sans s’y arrêter) et Saurus (BA), qui peuvent aussi s’y arrêter.',
 'La <b>cavalerie</b> ne monte pas sur une fortification, une demi-fortification ou un <b>village à toit plat</b> (elle n’y passe pas et ne s’y arrête pas).'])
s.append(P('7. L’arrivée d’une charge simple',h2))
s+=B(['La cible ne bouge pas : l’unité qui charge <b>va forcément à son contact</b>, sur une tuile libre adjacente à la cible.',
 'Si une charge jouée avant elle a allongé le chemin, elle y va quand même, <b>au-delà de sa portée</b>.',
 '<b>Facette de charge :</b> l’unité arrive sur la facette de la cible <b>la plus proche d’elle</b> (celle que traverse le trait de centre à centre).',
 '&nbsp;&nbsp;– facette occupée : elle occupe d’abord les autres <b>facettes de la charge</b> : les facettes avant pour une charge de face, les facettes arrière pour une charge à revers, d’après la vision et la prise à revers fixées à la pose et à la révélation des ordres (orientation de la cible à ce moment) ;',
 '&nbsp;&nbsp;– facette inaccessible (décor à contourner, terrain où l’unité ne peut pas se tenir, par exemple une fortification pour la cavalerie) : la plus proche par le trajet parmi les facettes de la charge ;',
 '&nbsp;&nbsp;– <b>surnombre</b> : l’étalement sur les autres facettes ne se fait que quand <b>toutes les facettes de la charge sont occupées</b> ; les unités se déploient alors autour de la cible, sur n’importe quelle facette libre accessible. Arriver sur une facette arrière <b>ne fait pas une prise à revers</b> ce tour-ci : la prise à revers est celle fixée à la pose et à la révélation des ordres.',
 'Une unité qui ne peut pas se tenir sur la tuile d’une facette (cavalerie et fortification) peut quand même combattre depuis une facette accessible, par exemple devant la porte.',
 '<b>Deuxième rideau :</b> si toutes les facettes accessibles de la cible sont occupées, l’unité s’avance <b>au plus près du combat</b>, en respectant les règles du déplacement de charge (chemin autorisé, sans traverser d’unité si possible, dans sa capacité de charge si possible). Elle ne combattra pas, n’étant pas au contact direct, mais elle <b>apporte son soutien</b> (§ 11). Elle ne prend jamais la place d’une unité déjà engagée ou ayant chargé avant elle.',
 'L’unité qui charge fait face à sa cible (automatique).',
 'La cible se tourne vers elle, <b>sauf si elle est déjà prise au corps à corps</b> par une autre unité.'])
s.append(P('8. Les charges mutuelles',h2))
s.append(P('Deux unités qui se chargent l’une l’autre avancent l’une vers l’autre sur le vrai trajet (§ 6). <b>Il y a toujours contact</b> : une unité qui n’a plus assez de portée rejoint quand même la ligne de front. <b>Exception :</b> si les deux charges échouent (les deux unités hors de portée l’une de l’autre à la révélation), chacune avance au maximum de sa capacité de charge, sans contact.'))
s+=B(['<b>Ligne de front par défaut : au milieu.</b> Chacune fait la moitié des tuiles libres qui les séparent ; nombre impair : un d10 chacune (relancé en cas d’égalité), la plus haute avance d’une tuile de plus.',
 '<b>Éléments de décor croisés :</b> chaque unité regarde le plus fort modificateur de terrain parmi les tuiles qu’elle traverse sur sa moitié du trajet (sa tuile de départ comprise).',
 '&nbsp;&nbsp;– Si l’une croise un modificateur plus fort que tout ce que croise l’autre, elle <b>peut s’arrêter</b> sur cette tuile (ou aller au milieu) ; l’autre <b>vient à son contact</b>, quelle que soit sa portée. Exemple : A croise une forêt (+2), B ne croise rien : A peut s’arrêter dans la forêt et B vient à son contact.',
 '&nbsp;&nbsp;– <b>Égalité</b> (même modificateur maximum des deux côtés, par exemple muret sur colline de chaque côté) : la charge se déroule <b>au milieu</b>.',
 '&nbsp;&nbsp;– <b>Pont</b> : si chaque unité est sur sa tuile d’entrée de pont, un seul <b>d10</b> (pas de dé de mi-chemin) désigne de quel côté du pont a lieu la charge (l’unité de ce côté garde sa tuile, l’autre traverse le pont pour venir au contact) ; le modificateur de pont ne s’applique à <b>aucune des deux unités</b>.',
 '<b>Une des deux unités déjà chargée</b> (par une charge jouée avant) : elle reste en place, au corps à corps ; l’autre fait <b>l’intégralité du trajet</b> pour venir à son contact (comme une charge simple réussie, au-delà de sa portée si besoin). Les deux déjà chargées : la charge mutuelle n’a pas lieu.',
 'S’il n’existe aucun trajet, même à travers les unités, chacune reste en place.',
 'À l’arrivée, les deux unités se font face.'])
s.append(box([['Modificateur de terrain d’une tuile','Valeur'],
 ['Colline (sauf unité volante en vol)','+1'],
 ['Forêt','+2'],
 ['Construction : fortification ou demi-fortification (sauf unité volante en vol), muret ; tuile autour des maisons d’un village, ou village à toit plat','+2'],
 ['Tuile juste avant un pont, pour l’unité dont l’adversaire arrive par le pont','+2'],
 ['Plusieurs éléments sur la même tuile (ex. muret sur colline)','ils s’additionnent']],[130*mm,44*mm]))
s.append(P('9. Les tirailleurs',h2))
s.append(P('<b>Position tirailleur :</b> une unité de tirailleurs (type T) avec l’ordre « tirailleur », posée sur <b>la tuile juste devant</b> une unité alliée de corps à corps ou mixte, c’est-à-dire la tuile voisine dans l’axe de son orientation (pas une autre tuile de ses côtés avant). Cette unité est l’<b>unité protégée</b>.'))
s+=B(['<b>Pas de tirailleurs seuls :</b> l’ordre « tirailleur » n’est possible que si une unité alliée de corps à corps ou mixte se trouve juste derrière.',
 'L’unité protégée ne peut pas déjà être au corps à corps.',
 '<b>Pour poser l’ordre « tirailleur »</b>, trois conditions : l’unité protégée est <b>juste derrière</b> les tirailleurs ; elle <b>regarde les tirailleurs</b> (ils sont sur la tuile juste devant elle) ; les tirailleurs <b>regardent dans la même direction</b> qu’elle. Sinon l’ordre est refusé.',
 '<b>Un seul ensemble, une seule orientation :</b> tirailleurs et unité protégée gardent la même orientation quand les tirailleurs suivent la charge ou échangent leur place avec elle.',
 'Les règles des tirailleurs s’appliquent avec les charges, à la <b>révélation des ordres</b> : aucun déplacement n’a encore eu lieu.'])
s.append(P('Quand l’unité protégée charge',h3))
s+=B(['Ses tirailleurs <b>ne gênent pas sa vision</b>, et elle les <b>traverse sans malus</b>.',
 'Les tirailleurs <b>accompagnent la charge</b> et se placent <b>juste derrière</b> l’unité qui charge (tuile libre la plus proche si celle-ci est prise). Ce n’est pas un déplacement pour eux : pas de malus de tir.'])
s.append(P('Quand un adversaire charge',h3))
s+=B(['<b>L’unité protégée n’est jamais chargée :</b> une charge qui la vise se dirige vers ses tirailleurs.',
 '<b>Un seul ensemble :</b> son centre est la tuile des tirailleurs, son orientation celle de l’unité protégée (la même pour les deux).',
 '<b>Distance de charge :</b> elle se mesure jusqu’aux tirailleurs, pas jusqu’à l’unité protégée.',
 'L’unité adverse vient au contact des tirailleurs, comme pour une charge.',
 'Pendant la <b>phase de tir</b>, les tirailleurs tirent sur elle : portée courte, sans malus. C’est leur tir du tour (ils n’en ont pas d’autre).',
 'À la fin de la phase de tir, avant le corps à corps, l’unité protégée et les tirailleurs <b>échangent leurs places</b> : l’unité protégée fait face à l’adversaire, et le corps à corps a lieu <b>entre les deux unités de corps à corps</b>.',
 'Vision et prise à revers sont fixées à la révélation, calculées depuis la tuile des tirailleurs (prise à revers selon l’orientation de l’unité protégée).',
 '<b>Sauvegarde +1 pour l’unité protégée, au corps à corps seulement</b> : +1 au seuil de l’unité qui l’attaque (pas au tir).',
 'Pendant les déplacements et les tirs, les tirailleurs sont devant l’unité protégée et ignorent le malus de tir « pris au corps à corps ».'])
s.append(P('10. Effets de la charge au corps à corps',h2))
s.append(P('Au corps à corps, chaque unité touche sur 4 + modificateurs (d10). Les effets de la charge valent <b>seulement pour le combat du tour de la charge</b> :'))
s.append(box([['Situation','Modificateur','Pour qui'],
 ['Charge','−1','l’unité qui charge'],
 ['Prise à revers','−2','l’unité qui charge (cumulable avec la charge : −3)'],
 ['Charge sans voir','+4 (bonus de sauvegarde de la cible)','s’ajoute au seuil de l’unité qui charge ; cumulable (ex. charge à revers sans voir : −1 −2 +4 = +1)'],
 ['Tuile protectrice occupée par la cible','son modificateur de terrain (§ 8)','s’ajoute au seuil de l’unité qui l’attaque'],
 ['Charge de cavalerie (C)','attaque ×2','sauf si la cible est en forêt ou dans une construction (fortification, muret, village, sortie de pont)'],
 ['Cible en vol stationnaire (vs)','+2','sauvegarde de la cible au corps à corps'],
 ['Cible en marche forcée','−2','pour l’unité qui l’attaque']],[42*mm,52*mm,80*mm]))
s.append(Spacer(1,3))
s.append(P('Même principe qu’au tir, où « sans voir » (+4) se cumule déjà avec les autres modificateurs.',small))
s+=B(['<b>Selon l’unité qui attaque :</b> une unité volante en vol n’a ni malus ni protection par les hauteurs (colline, fortification) et attaque un pont sans malus ; une unité qui saute attaque une fortification et un pont sans malus. La sauvegarde correspondante de la cible ne compte pas.',
 '<b>Marqueurs :</b> les sauvegardes de terrain de la cible (colline, forêt, construction, sortie de pont) et la charge de cavalerie ×2 sont affichées à côté de l’ordre de charge : à l’attaquant dès la pose de l’ordre, puis à tous une fois les ordres révélés, pour comprendre le calcul. Ils ne sont recalculés que si l’unité qui porte ces marqueurs se déplace elle-même pour charger (charge mutuelle) ; si elle garde sa tuile pour conserver ses sauvegardes et que l’adversaire doit s’avancer jusqu’à elle, ses marqueurs ne changent pas.'])
s.append(P('11. Soutien',h2))
s+=B(['<b>Soutien arrière :</b> une unité alliée <b>libre</b> (pas au corps à corps), de corps à corps ou mixte, à <b>2 hex au plus derrière l’attaquant</b>.',
 '<b>Soutien avant :</b> une unité alliée <b>libre ou en prise à revers</b>, de corps à corps ou mixte, à <b>2 hex au plus devant l’attaquant</b>.',
 'Ne peut pas soutenir : une unité en tirailleur, ou une unité qui a débordé.',
 '<b>Effet :</b> attaque −1 (corps à corps seulement). Soutien avant et soutien arrière se cumulent (−2).',
 'Une unité en deuxième rideau (§ 7) apporte son soutien si elle remplit ces conditions.'])
s.append(P('Les autres déplacements (après les charges) se font à tour de rôle entre les équipes.',small))
s.append(P('12. Zone d’interdiction',h2))
s+=B(['Lors d’un déplacement ou d’un débordement, l’attaquant ne peut pas s’arrêter en touchant un défenseur (une unité adverse).',
 'Exceptions : la <b>charge</b> ; et, pour un déplacement simple, une <b>différence de hauteur</b> entre les deux unités (niveaux de la règle de vision : colline, fortification, village à toit plat) : elles peuvent alors être côte à côte.'])
s.append(P('13. Récapitulatif et état dans le jeu',h2))
s.append(box([['Étape','Règle','Dans le jeu'],
 ['Pose','Corps à corps ou mixte ; cible à 5 tuiles (7 avec charge +2) par le chemin autorisé ; indications revers / vision','Codé'],
 ['Révélation','Charge obligatoire ; succès, vision, revers et traversée fixés ; hors de portée = échouée, l’unité avance au maximum de sa capacité de charge','Codé (capacité à confirmer)'],
 ['File','De la plus courte à la plus longue ; égalité au d10','Codé'],
 ['Arrivée','Toujours au contact (même au-delà de la portée) ; sinon deuxième rideau ; orientations','Codé'],
 ['Mutuelle','Toujours au contact ; décor au plus fort modificateur sinon milieu ; d10 si impair','Codé'],
 ['Tirailleurs','Juste devant l’unité protégée ; charge redirigée sur eux ; tir pendant la phase de tir ; échange de places ; ils suivent la charge de l’unité protégée','Codé (sauvegarde +1 au tir ; mêlée à venir)'],
 ['Zone d’interdiction','Pas d’arrêt au contact d’un adversaire en déplacement (sauf charge ou différence de hauteur)','Codé (débordement : à venir)'],
 ['Corps à corps','Charge −1, revers −2, sans voir +4, tuile protectrice, soutiens −1 / −1, tirailleurs +1','À venir']],[28*mm,112*mm,34*mm]))
def foot(c,d):
    c.saveState(); c.setFont('S',7.5); c.setFillColor(colors.HexColor('#8a8f98'))
    c.drawString(18*mm,10*mm,'La charge — règles du jeu'); c.drawRightString(A4[0]-18*mm,10*mm,'page %d'%d.page); c.restoreState()
doc=SimpleDocTemplate('/home/claude/p2/REGLES-CHARGE.pdf',pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=16*mm,bottomMargin=18*mm,title='La charge',author='MJ')
doc.build(s,onFirstPage=foot,onLaterPages=foot)
