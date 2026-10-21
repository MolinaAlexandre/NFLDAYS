# PocketReplay 3D

## 👉 [Ouvrir la démo en ligne](https://molinaalexandre.github.io/NFLDAYS/)

**Rien à installer : ouvrez simplement [https://molinaalexandre.github.io/NFLDAYS/](https://molinaalexandre.github.io/NFLDAYS/) dans Chrome, Firefox ou Edge.**

- Moment fort : [un sack revu « dans les yeux du QB »](https://molinaalexandre.github.io/NFLDAYS/#g=2021091200&p=2631&cam=qb&t=2.8)
- Cliquez sur une action dans la liste de gauche, changez de caméra en haut, et cliquez sur un joueur pour le suivre.


**Ce qu'on a construit :** un outil de revue vidéo 3D dans le navigateur qui recrée chaque dropback de la saison NFL 2021 (semaines 1 à 8, 8 557 actions) à partir du tracking à 10 Hz. On peut rejouer, ralentir et changer d'angle : vue TV, All-22, vue défense, vue du dessus, caméra qui suit un joueur, et surtout **« Yeux du QB »**, en première personne. Un pipeline Python repère automatiquement les faits de jeu (sacks, hits, hurries, bloqueurs battus, passes rapides…) pour que le coach clique dessus et revoie l'action. Il calcule aussi une nouvelle métrique, le **Pocket Clock** : le temps entre le snap et l'arrivée du premier rusher à moins de 2 yards du QB, accompagné de la courbe de la surface de la poche.

**Ce que ça révèle :** on voit à quel moment la poche s'effondre, quel bloqueur a cédé et face à qui, et si le QB a lâché le ballon avant ou après la pression (la « marge du QB »). Le classement agrège ces données par rusher, par bloqueur et par équipe.

**Qui l'utiliserait :** un coach de ligne offensive ou défensive pour préparer la vidéo de la semaine, un recruteur pour comparer la vitesse de pression des pass rushers, ou un commentateur pour expliquer un sack sous l'angle du QB.

## Lancer

```bash
# 1. pipeline (Python : pandas, numpy) -> web/data/
uv run --with pandas --with numpy python pipeline.py      # ~10 min pour les 122 matchs
# 2. viewer
cd web && python3 -m http.server 8765                       # http://localhost:8765
```

Lien direct vers une action, une caméra et un instant : `http://localhost:8765/#g=2021091200&p=2631&cam=qb&t=2.8`

## Mettre en ligne (GitHub Pages, gratuit)

```bash
./app/deploy.sh    # gzip des données (206 Mo -> 71 Mo) + push du site sur la branche gh-pages
```
Une seule fois, dans les Settings du repo, section Pages : Source « Deploy from a branch », branche `gh-pages`, dossier `/ (root)`.
Le site est ensuite servi sur `https://molinaalexandre.github.io/NFLDAYS/`.

## Structure

- `pipeline.py` : chargement du tracking et du scouting PFF, métriques (temps avant la passe, Pocket Clock, surface de la poche, distance minimale d'un rusher), tags et classements. Sorties : `web/data/index.json` et `web/data/games/<gameId>.json`.
- `web/` : viewer Three.js (WebGL), sans étape de build.
- Modèle joueur : `web/models/player.glb` (source `blender/player.blend`, 1 unité = 1 yard, pieds à l'origine, regard vers +X). Il est articulé (`hips` > `torso` > `upperarm_*` > `forearm_*`, `hips` > `thigh_*` > `shin_*`) et ses matériaux (`jersey`, `helmet`, `facemask`, `stripe`, `trim`, `pants`, `socks`) sont recolorés par équipe avec `web/kits.js` (tenues 2021, domicile / extérieur). Sans le fichier, le viewer revient aux formes simples.
- Animations procédurales (`web/anim.js`) : foulée calée sur la distance parcourue dans le tracking (donc exacte en pause et au scrubbing, inversée en backpedal), postures selon le rôle PFF (bloqueur, rusher, receveur, couverture), QB qui tient le ballon puis arme et lance autour de l'événement `pass_forward`. Le ballon reste dans la main du QB tant qu'il le porte.
- Vue « Yeux du QB » : main et ballon au premier plan jusqu'au lâcher, puis la caméra se tourne vers le point visé et suit le ballon jusqu'à la fin de l'action.

## Fin d'action calculée (hors tracking)

Le tracking s'arrête 0,5 s après la passe. `web/sim.js` reconstruit la suite. Dans l'interface, cette partie est **clairement marquée comme calculée** : zone hachurée violette sur la timeline et le graphe, bandeau « CALCULÉ », joueurs translucides, tracés en pointillés, et la source de chaque chiffre est indiquée.
- **Cible :** lue dans la description (« pass deep left to A.Cooper » → Amari Cooper, ou « INTERCEPTED by … »). Sinon, c'est le receveur le mieux aligné avec la direction mesurée du ballon.
- **Vitesse du ballon :** mesurée sur les dernières images du tracking.
- **Point de réception :** la trajectoire du receveur est prolongée à sa dernière vitesse mesurée jusqu'à l'arrivée du ballon. On en déduit le temps de vol et les **air yards / YAC estimés**.
- **Spot final :** ligne de scrimmage + `playResult` officiel (TD → end zone).
- **Défenseurs :** ils convergent sur le ballon puis poursuivent le porteur ; les autres joueurs ralentissent. La hauteur du ballon est une parabole, car la donnée n'a pas de z.

## Limites des données

Le tracking ne couvre que les dropbacks et s'arrête 0,5 s après la passe ou le sack : il n'y a ni vol du ballon ni course après la réception.
