# NFLDAYS — PocketReplay 3D

Outil de revue 3D de la protection de passe NFL (Big Data Bowl, saison 2021 sem. 1–8).

## 👉 [Ouvrir la démo en ligne](https://molinaalexandre.github.io/NFLDAYS/)

**Rien à installer : ouvrez simplement [https://molinaalexandre.github.io/NFLDAYS/](https://molinaalexandre.github.io/NFLDAYS/) dans Chrome, Firefox ou Edge.**

- Moment fort : [un sack revu « dans les yeux du QB »](https://molinaalexandre.github.io/NFLDAYS/#g=2021091200&p=2631&cam=qb&t=2.8)
- Cliquez sur une action dans la liste de gauche, changez de caméra en haut, et cliquez sur un joueur pour le suivre.

## Lancer en local (facultatif)

Le code et la documentation détaillée sont dans [`app/`](app/README.md).

```bash
git clone https://github.com/ThompsonJamesBliss/nfl-big-data-bowl-regional-event-data
cd app && uv run --with pandas --with numpy python pipeline.py   # génère web/data/
cd web && python3 -m http.server 8765                              # http://localhost:8765
```
