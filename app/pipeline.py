"""NFL Pocket Replay - data pipeline.

Reads the Big Data Bowl tracking + PFF scouting data, computes per-play pass-rush
metrics (time to throw, "Pocket Clock" = time until the first rusher gets within
2 yards of the QB, pocket area, minimum rusher distance) and tags notable plays
(sacks, hits, hurries, beaten blockers...). Exports compact JSON consumed by the
3D viewer in web/.

Usage:  uv run --with pandas --with numpy python pipeline.py
"""
import glob
import json
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "nfl-big-data-bowl-regional-event-data" / "data"
OUT = ROOT / "web" / "data"

SNAP_EVENTS = {"ball_snap", "autoevent_ballsnap"}
END_EVENTS = {"pass_forward", "autoevent_passforward", "qb_sack", "qb_strip_sack",
              "run", "pass_shovel", "fumble"}
PRESSURE_RADIUS = 2.0  # yards
HZ = 10.0


def hull(points):
    """Convex hull (monotone chain) of a list of (x, y) tuples."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def polygon_area(poly):
    if len(poly) < 3:
        return 0.0
    a = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def clean(o):
    """Recursively replace NaN with None and numpy scalars with python ones (valid JSON)."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return None if math.isnan(o) else float(o)
    return o


def flag(v):
    return v == 1 or v == 1.0


def load_pff():
    pff = pd.read_csv(DATA / "pffScoutingData.csv")
    by_play = {}
    for (gid, pid), g in pff.groupby(["gameId", "playId"]):
        by_play[(gid, pid)] = {int(r.nflId): r for r in g.itertuples(index=False)}
    return by_play


def process_play(g, meta, pff_roles):
    n = int(g.frameId.max())
    frames = np.arange(1, n + 1)

    ev_rows = g.dropna(subset=["event"]).drop_duplicates(["frameId", "event"])
    events = sorted((int(f), e) for f, e in zip(ev_rows.frameId, ev_rows.event))
    snap = next((f for f, e in events if e in SNAP_EVENTS), 1)
    end = next((f for f, e in events if e in END_EVENTS and f >= snap), n)
    direction = g.playDirection.iloc[0]
    sign = 1 if direction == "right" else -1

    ents, series = [], {}
    g = g.assign(nid=g.nflId.fillna(-1).astype(int))
    for nid, e in g.groupby("nid", sort=False):
        e = e.drop_duplicates("frameId").set_index("frameId").reindex(frames)
        e[["x", "y", "s"]] = e[["x", "y", "s"]].ffill().bfill()
        e["o"] = e["o"].ffill().bfill().fillna(0)
        series[nid] = e
        r = pff_roles.get(nid)
        ents.append({
            "id": int(nid),
            "j": None if nid == -1 else int(e.jerseyNumber.dropna().iloc[0]) if e.jerseyNumber.notna().any() else None,
            "t": "football" if nid == -1 else e.team.dropna().iloc[0],
            "r": r.pff_role if r is not None else ("Ball" if nid == -1 else ""),
            "pl": r.pff_positionLinedUp if r is not None and isinstance(r.pff_positionLinedUp, str) else "",
            "blk": int(r.pff_nflIdBlockedPlayer) if r is not None and not pd.isna(r.pff_nflIdBlockedPlayer) else None,
            "d": np.round(np.column_stack([e.x, e.y, e.o, e.s]), 2).ravel().tolist(),
        })

    # order: offense, defense, ball last
    off = meta["possessionTeam"]
    ents.sort(key=lambda en: (en["t"] == "football", en["t"] != off, en["j"] or 0))

    qb = next((nid for nid, r in pff_roles.items() if r.pff_role == "Pass" and nid in series), None)
    rushers = [nid for nid, r in pff_roles.items() if r.pff_role == "Pass Rush" and nid in series]
    blockers = [nid for nid, r in pff_roles.items() if r.pff_role == "Pass Block" and nid in series]

    min_dist = [None] * n
    area = [0.0] * n
    nearest = [None] * n
    if qb is not None:
        qx, qy = series[qb].x.values, series[qb].y.values
        if rushers:
            dists = np.array([np.hypot(series[r].x.values - qx, series[r].y.values - qy) for r in rushers])
            min_dist = np.round(dists.min(axis=0), 2).tolist()
            nearest = [rushers[i] for i in dists.argmin(axis=0)]
        for i in range(n):
            pts = [(series[b].x.values[i], series[b].y.values[i]) for b in blockers] + [(qx[i], qy[i])]
            area[i] = round(polygon_area(hull(pts)), 1)

    ttt = round((end - snap) / HZ, 1)
    ttp, pressure_by = None, None
    for i in range(snap - 1, min(end, n)):
        if min_dist[i] is not None and min_dist[i] < PRESSURE_RADIUS:
            ttp = round((i + 1 - snap) / HZ, 1)
            pressure_by = nearest[i]
            break

    # pocket collapse: area 0.5s after snap (pocket formed) vs at throw/sack
    a0 = area[min(snap - 1 + 5, n - 1)]
    a1 = area[end - 1]
    collapse = round(100 * (1 - a1 / a0), 0) if a0 > 0 else None

    ball = series.get(-1)
    los = float(ball.x.values[snap - 1]) if ball is not None else None

    return {
        "n": n, "snap": snap, "end": end, "dir": direction,
        "events": [[f, e] for f, e in events],
        "los": los,
        "fd": los + sign * meta["yardsToGo"] if los is not None else None,
        "ents": ents, "area": area, "md": min_dist,
    }, {"ttt": ttt, "ttp": ttp, "pressureBy": pressure_by, "collapse": collapse,
        "minDist": min(d for d in min_dist[snap - 1:end] if d is not None) if qb and rushers else None}


def tags_for(meta, metrics, roles):
    tags = []
    pr = meta["passResult"]
    if pr == "S": tags.append("SACK")
    if pr == "IN": tags.append("INT")
    if pr == "R": tags.append("SCRAMBLE")
    if any(flag(r.pff_hit) for r in roles.values()): tags.append("HIT")
    if any(flag(r.pff_hurry) for r in roles.values()): tags.append("HURRY")
    if any(flag(r.pff_beatenByDefender) or flag(r.pff_hitAllowed) or flag(r.pff_hurryAllowed)
           or flag(r.pff_sackAllowed) for r in roles.values()): tags.append("BEATEN")
    if metrics["ttp"] is not None and metrics["ttp"] <= metrics["ttt"]: tags.append("PRESSURE")
    if metrics["ttt"] < 2.5 and pr in ("C", "I", "IN"): tags.append("QUICK")
    if metrics["ttt"] >= 4.0: tags.append("HOLD")
    if isinstance(meta["playResult"], (int, float)) and meta["playResult"] >= 20: tags.append("BIG")
    if "TOUCHDOWN" in str(meta["playDescription"]).upper(): tags.append("TD")
    return tags


SCORE = {"SACK": 6, "INT": 5, "TD": 4, "HIT": 3, "BIG": 3, "PRESSURE": 2, "HURRY": 1,
         "BEATEN": 1, "SCRAMBLE": 1, "HOLD": 1, "QUICK": 0}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "games").mkdir(exist_ok=True)
    games = pd.read_csv(DATA / "games.csv")
    plays = pd.read_csv(DATA / "plays.csv")
    players = pd.read_csv(DATA / "players.csv")
    print("loading PFF scouting...")
    pff = load_pff()
    plays_meta = {(r["gameId"], r["playId"]): r for r in plays.to_dict("records")}

    index = []
    files = sorted(glob.glob(str(DATA / "tracking" / "tracking_*.csv")))[:int(os.environ.get("LIMIT", 10**6))]
    for k, f in enumerate(files):
        t = pd.read_csv(f, usecols=["gameId", "playId", "nflId", "frameId", "jerseyNumber", "team",
                                    "playDirection", "x", "y", "s", "o", "event"])
        gid = int(t.gameId.iloc[0])
        out = {}
        for pid, g in t.groupby("playId", sort=False):
            meta = plays_meta.get((gid, pid))
            if meta is None:
                continue
            roles = pff.get((gid, pid), {})
            play, metrics = process_play(g, meta, roles)
            out[int(pid)] = play
            beaten = []
            credits = []
            for nid, r in roles.items():
                for kind, col in (("sack", "pff_sackAllowed"), ("hit", "pff_hitAllowed"),
                                  ("hurry", "pff_hurryAllowed"), ("beaten", "pff_beatenByDefender")):
                    if flag(getattr(r, col)):
                        beaten.append({"b": nid, "d": None if pd.isna(r.pff_nflIdBlockedPlayer) else int(r.pff_nflIdBlockedPlayer), "k": kind})
                        break
                for kind, col in (("sack", "pff_sack"), ("hit", "pff_hit"), ("hurry", "pff_hurry")):
                    if flag(getattr(r, col)):
                        credits.append({"p": nid, "k": kind})
                        break
            tags = tags_for(meta, metrics, roles)
            index.append({
                "g": gid, "p": int(pid),
                "desc": meta["playDescription"], "q": meta["quarter"], "down": meta["down"],
                "ytg": meta["yardsToGo"], "clock": meta["gameClock"],
                "off": meta["possessionTeam"], "def": meta["defensiveTeam"],
                "res": meta["passResult"], "yds": meta["playResult"],
                "cov": meta["pff_passCoverage"] if isinstance(meta["pff_passCoverage"], str) else "",
                "form": meta["offenseFormation"] if isinstance(meta["offenseFormation"], str) else "",
                **metrics, "tags": tags, "score": sum(SCORE[x] for x in tags),
                "beaten": beaten, "credits": credits,
            })
        with open(OUT / "games" / f"{gid}.json", "w") as fh:
            json.dump(clean(out), fh, separators=(",", ":"), allow_nan=False, default=str)
        print(f"[{k + 1}/{len(files)}] game {gid}: {len(out)} plays")

    # leaderboards
    df = pd.DataFrame(index)
    pressures = df.dropna(subset=["pressureBy"])
    pressures = pressures[pressures.ttp <= pressures.ttt]
    rush = (pressures.groupby("pressureBy").ttp.agg(["count", "median"]).reset_index()
            .sort_values(["count", "median"], ascending=[False, True]).head(25))
    beaten_rows = [b for row in index for b in row["beaten"] if b["k"] in ("sack", "hit", "hurry")]
    ol = pd.Series([b["b"] for b in beaten_rows]).value_counts().head(25)
    team = (df.groupby("off").agg(ttt=("ttt", "mean"), sacks=("res", lambda s: (s == "S").sum()),
                                  pressured=("tags", lambda s: sum("PRESSURE" in x for x in s)),
                                  plays=("p", "count")).reset_index())
    team["pressureRate"] = (100 * team.pressured / team.plays).round(1)
    team["ttt"] = team.ttt.round(2)

    used = set(df.pressureBy.dropna().astype(int)) | {b["b"] for b in beaten_rows}
    for row in index:
        used |= {b["b"] for b in row["beaten"]} | {b["d"] for b in row["beaten"] if b["d"]} | {c["p"] for c in row["credits"]}
    pl = {int(r.nflId): {"n": r.displayName, "pos": r.officialPosition} for r in players.itertuples()}

    for row in index:
        if row["pressureBy"] is not None:
            row["pressureBy"] = int(row["pressureBy"])

    result = {
        "games": games.to_dict("records"),
        "players": pl,
        "plays": index,
        "leaders": {
            "rushers": [{"id": int(r.pressureBy), "count": int(r["count"]), "median": round(float(r["median"]), 2)}
                        for _, r in rush.iterrows()],
            "blockers": [{"id": int(i), "count": int(c)} for i, c in ol.items()],
            "teams": team.sort_values("pressureRate").to_dict("records"),
        },
    }
    with open(OUT / "index.json", "w") as fh:
        json.dump(clean(result), fh, separators=(",", ":"), allow_nan=False, default=str)
    print(f"done: {len(index)} plays -> {OUT}")


if __name__ == "__main__":
    main()
