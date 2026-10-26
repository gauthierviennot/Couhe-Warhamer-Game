# Règle de vision (charges et tirs) — validée par le MJ le 25/10/2026, codée le 25/10 (server.js `visionCheck`, test `tests/t_vision.js`)

## 1. La méthode
**Déroulement d'un tour, et moment du calcul :**
1. Pose des ordres. Chaque unité reçoit un seul ordre : charge, tir, déplacement, marche forcée ou tirailleur (jamais charge et tir à la fois, même pour une unité qui sait faire les deux). Une unité volante indique en plus sa position : en vol ou au sol. La vision d'une charge est affichée au joueur à titre indicatif, puis fixée à la révélation des ordres.
2. Charges et déplacements.
3. Tirs : la vision de chaque tir est calculée au moment où il part, avec les positions de ce moment (après les charges et les déplacements).
4. Corps à corps. Une unité mixte qui avait un ordre de tir tire d'abord, puis combat au corps à corps si elle est engagée.

**Comment on calcule :**
- Un trait du centre de la tuile de l'unité qui agit (qui charge ou qui tire) au centre de la tuile de la cible.
- Seules comptent les tuiles traversées entre les deux. La tuile de chaque unité ne gêne pas sa propre vue, sauf la forêt (point 11).
- Si le trait longe exactement le bord entre deux tuiles, il suffit qu'un des deux côtés soit dégagé.
- Une unité amie a exactement le même effet sur la vision qu'une unité ennemie.

**Résultat :**
- Charge : la vision est fixée à la révélation des ordres (recalcul de toutes les charges). À la pose de l'ordre, le joueur voit déjà l'indication (👁 ou œil barré, avec la raison), calculée avec les positions du moment et une unité volante adverse supposée en vol ; elle ne change à la révélation que si la cible volante est en fait au sol (ou si le MJ a modifié la carte entre-temps).
- Tir : si la cible n'est pas visible, le modificateur « sans voir » (+4) est coché ; le MJ peut le corriger. Pour l'artillerie, la vision décide si la relance sur 4 peut toucher.
- Les règles propres au tir dans une mêlée (dé à 1 qui touche une unité amie, etc.) sont indépendantes de la vision.

## 2. Le terrain : niveaux et obstacles
- Niveau 0 : plaine et autres terrains plats.
- Niveau 1 : colline ; fortification, demi-fortification ou village à toit plat posé en plaine.
- Niveau 2 : fortification, demi-fortification ou village à toit plat posé sur une colline.
- Fortification et demi-fortification fonctionnent de la même manière.
- Forêt et village simple : obstacles au niveau de leur tuile (0 en plaine, 1 sur une colline) ; ils n'ajoutent pas de niveau.
- La montagne bloque toujours la vue, pour toutes les unités.
- Ne bloquent jamais : muret, pont, route, eau, marécage, terrain plat.

## 3. Où se trouvent les unités
- En plaine ou sur un autre terrain plat (route, marécage) : niveau 0. Sur une colline : niveau 1.
- Dans une forêt : niveau de la tuile (0 ou 1). Voir point 11.
- Sur une fortification, une demi-fortification ou un village à toit plat : niveau 1 en plaine, 2 sur une colline ; on la voit selon les règles normales de niveau ; elle voit à 360° (point 5).
- Jamais dans un village simple (seulement à côté), ni sur une montagne. Sur l'eau seulement sur un pont, sauf les Saurus (niveau 0).

## 4. Les types d'unités
| | Voit par-dessus les unités, et on la voit par-dessus | Voit par-dessus relief, forêts, villages, fortifications, et on la voit par-dessus | Bloque la vue entre deux autres unités | Cachée par un abri juste à côté | Montagne |
|---|---|---|---|---|---|
| Unité au sol, unité qui saute (jump) | non | non | oui (même niveau) | oui | bloque |
| Grande taille | oui | non | oui (même niveau) | oui | bloque |
| Unité volante (v / vs) au sol | oui | non | oui (même niveau) | oui | bloque |
| Unité volante (v / vs) en vol | oui | oui | non | non | bloque |

- Unités qui sautent : aucun bonus de vision.
- Grandes tailles : voient par-dessus les unités et on les voit par-dessus ; pour le reste, règles des unités au sol ; valable en mêlée ou non.
- Unités volantes (v) et en vol stationnaire (vs) : pour la vision, toujours au moins des grandes tailles.
  - À chaque ordre (charge, tir, déplacement, marche forcée, tirailleur), elles choisissent :
    - En vol (par défaut) : en plus, voient par-dessus tous les obstacles sauf les montagnes, et on les voit de même ; les abris ne les protègent pas ; elles se déplacent en volant.
    - Au sol : vision d'une grande taille ; elles se déplacent comme une unité au sol pendant tout le tour (forêt et marécage payants, pas d'eau sans pont, ni montagnes ni unités survolées).
  - Choix : court message avec deux boutons « ✈️ En vol » (présélectionné) et « Au sol » posés à côté de l'unité.
  - Durée : tout le tour (déplacement, charge, tir et corps à corps), quand l'unité agit comme quand elle est prise pour cible.
  - L'adversaire subit ce choix : la vision d'une charge contre une unité volante est d'abord affichée « en vol », puis recalculée avec le vrai choix à la révélation des ordres.

## 5. ⚠️ Réciprocité et ses deux seules exceptions
La vision est réciproque : si A voit B, B voit A. Deux exceptions seulement :
1. Action vers l'arrière : si le trait part par l'un des 3 côtés arrière de l'unité qui charge ou qui tire, elle agit sans voir, quels que soient les obstacles (la cible peut la voir). Un trait qui passe exactement par le coin avant/arrière compte comme avant. Sauf une unité sur une fortification, une demi-fortification ou un village à toit plat : elle voit à 360°, pour les charges comme pour les tirs.
2. Unité dans une forêt (au sol, grande taille ou volante au sol) : on ne la voit pas, mais elle voit (point 11).

## 6. Les abris
- Une unité est cachée si la tuile juste à côté d'elle sur le trait est un abri : forêt, village (simple ou à toit plat), fortification, colline plus haute qu'elle.
- Pour l'unité qui agit comme pour la cible, en haut comme en bas, grandes tailles et unités volantes au sol comprises ; pas les unités volantes en vol.
- Réciproque : l'unité abritée ne voit pas non plus de ce côté.
- Quand les deux unités sont à des niveaux différents, une unité juste à côté n'est pas un abri (l'unité haute voit par-dessus).
- Exemples : unité au bord d'une colline avec une forêt juste en contrebas → cachée d'une unité en plaine, et réciproquement. Fortification sur colline, puis tuile de cette colline, puis unité en plaine au pied → l'unité en plaine est cachée.

## 7. Deux unités au même niveau (aucune n'est une unité volante en vol)
- Ligne horizontale. Bloquent, où qu'ils soient sur le trait : montagne ; tuile plus haute que les deux unités ; au même niveau, forêt, village (simple ou à toit plat), fortification ; au même niveau, une unité sur le trait, petite, de grande taille ou volante restée au sol (correction du MJ du 26/10 : une grande taille cache la vue comme une petite ; seule une unité volante en vol ne la cache pas) — sauf si l'une des deux unités qui se regardent est une grande taille ou une unité volante.
- Une tuile plus basse ne bloque pas, avec tout ce qu'elle porte. Abri juste à côté : point 6.
- Exemples : deux collines séparées par une vallée → se voient tant que rien dans la vallée ne dépasse le niveau 1 (sauf abri collé à l'une) ; fortification ou village à toit plat sur une colline (niveau 2) dans la vallée → ne se voient pas ; forêt ou village simple entre deux unités sur la même colline → ne se voient pas ; unité au sol entre deux unités en plaine → ne se voient pas, sauf si l'une est une grande taille ou une unité volante.

## 8. Deux unités à des niveaux différents (aucune n'est une unité volante en vol)
L'« unité haute » est la plus élevée. Bloqué seulement par :
1. une montagne sur le trait ;
2. un relief aussi haut que l'unité haute : tuile traversée de niveau égal ou supérieur au sien (dont forêt ou village simple sur une colline au même niveau) — au milieu d'une colline de 3 tuiles l'unité ne voit pas la plaine, au bord la vue passe sauf abri ;
3. un abri juste à côté de l'une des deux unités (point 6).
Ailleurs sur le trait, ce qui est plus bas que l'unité haute ne bloque pas.
Exemples : pied et bord de colline côte à côte → se voient ; pied et milieu d'une colline de 3 tuiles → non ; unité sur fortification ou village à toit plat isolé → voit toute la plaine dans toutes les directions, sauf unité collée à un abri ; bord de colline et plaine avec une forêt au milieu de la plaine et une tuile dégagée avant l'unité en plaine → se voient.

## 9. Une unité volante en vol face à une autre unité
La cible est visible, sauf : montagne sur le trait ; action vers l'arrière ; cible à l'intérieur d'une forêt (pas à côté) qui n'est pas une unité volante en vol. Une unité cachée derrière une forêt est visible d'une unité volante en vol.

## 10. Tirs : ce qui ne change pas
Les modificateurs de protection de la cible restent (forêt dans ou derrière +2, colline +1, constructions +2, étendard…). La vision ne fait que cocher ou non « sans voir » (+4).

## 11. La forêt (prioritaire sur les autres règles)
- Unité au sol, grande taille ou unité volante au sol, dans une forêt : toujours cachée (quelle que soit la distance, même juste à côté, même d'une unité volante en vol) ; elle voit les autres avec ses propres règles.
- Unité volante en vol dans une forêt : elle voit et on la voit.

# Déplacement des charges (lié à la vision)
- Unités au sol, grandes tailles et unités volantes au sol : ne traversent aucune unité, amie ou ennemie ; vrai chemin qui contourne, dans la limite de la portée. Sans chemin libre à la révélation des ordres, l'unité traverse les unités sur son passage (dans sa portée) : charge sans voir. Arrêt sur une tuile libre au contact de la cible ; si elles sont toutes prises, au plus près en deuxième rideau (pas de combat). Chemin le plus court, en traversant le moins d'unités possible.
- Unités volantes en vol et unités qui sautent : passent au-dessus des unités, amies ou ennemies.
- Montagnes : survolées par les unités volantes en vol, franchies par celles qui sautent ; jamais traversées par les grandes tailles, les unités volantes au sol et les autres unités au sol.
- Charges mutuelles : mêmes règles de trajet ; toujours au contact, même au-delà de la portée (voir REGLES-CHARGE.pdf).
- Charge obligatoire une fois les ordres révélés. Succès et vision sont fixés à la révélation des ordres (positions de ce moment) : l'ordre des charges n'y change rien. Une charge réussie va au contact même si une charge précédente a allongé le chemin.
