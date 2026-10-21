# NFLDAYS — PocketReplay 3D

Outil de revue 3D de la protection de passe NFL (Big Data Bowl, saison 2021 sem. 1–8). Tout est dans [`app/`](app/README.md).

```bash
git clone https://github.com/ThompsonJamesBliss/nfl-big-data-bowl-regional-event-data
cd app && uv run --with pandas --with numpy python pipeline.py   # génère web/data/
cd web && python3 -m http.server 8765                              # http://localhost:8765
```
