from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
import datetime

BASE_URL = "https://api.sleeper.app/v1"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"]
    ,allow_headers=["*"]
)
@app.get("/")
def healthcheck():
    return {"status": "ok"}

def get_user(user_identifier: str):
    r = requests.get(f"{BASE_URL}/user/{user_identifier}")
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="User not found")
    return r.json()


def get_leagues(user_id: str, season: int):
    r = requests.get(f"{BASE_URL}/user/{user_id}/leagues/nfl/{season}")
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="Leagues not found for user")
    return r.json()


def get_rosters(league_id: str):
    r = requests.get(f"{BASE_URL}/league/{league_id}/rosters")
    r.raise_for_status()
    return r.json()


def get_matchups(league_id: str, week: int):
    r = requests.get(f"{BASE_URL}/league/{league_id}/matchups/{week}")
    r.raise_for_status()
    return r.json()


def get_players():
    r = requests.get(f"{BASE_URL}/players/nfl")
    r.raise_for_status()
    raw = r.json()
    # normalize player objects we care about
    players = {}
    for pid, info in raw.items():
        full_name = info.get("full_name") or (
            ((info.get("first_name") or "").strip() + " " + (info.get("last_name") or "").strip()).strip()
        )
        team = info.get("team") or "FA"
        pos = info.get("position") or ""
        players[pid] = {
            "id": pid,
            "name": full_name or pid,
            "team": team,
            "position": pos,
        }
    return players


@app.get("/user/{username}/leagues")
def api_leagues(username: str, season: int | None = None):
    if season is None:
        season = datetime.datetime.now().year
    user = get_user(username)
    leagues = get_leagues(user["user_id"], season)
    # return minimal league info
    return [
        {"league_id": lg["league_id"], "name": lg.get("name", "Unnamed League")}
        for lg in leagues
    ]


@app.get("/user/{username}/lineups/{week}")
def api_lineups(username: str, week: int, season: int | None = None):
    if season is None:
        season = datetime.datetime.now().year

    user = get_user(username)
    user_id = user["user_id"]
    leagues = get_leagues(user_id, season)

    players = get_players()
    out = {"leagues": [], "players": players}

    for lg in leagues:
        league_id = lg["league_id"]
        name = lg.get("name", "Unnamed League")

        rosters = get_rosters(league_id)
        my_roster_id = None
        for r in rosters:
            if r.get("owner_id") == user_id:
                my_roster_id = r.get("roster_id")
                break
        if my_roster_id is None:
            continue

        matchups = get_matchups(league_id, week)

        my_matchup, opp_matchup = None, None
        for m in matchups:
            if m.get("roster_id") == my_roster_id:
                my_matchup = m
                mid = m.get("matchup_id")
                for o in matchups:
                    if o.get("matchup_id") == mid and o.get("roster_id") != my_roster_id:
                        opp_matchup = o
                        break
                break

        if my_matchup is None:
            continue

        out["leagues"].append({
            "league_id": league_id,
            "name": name,
            "my_roster_id": my_roster_id,
            "my_starters": [p for p in my_matchup.get("starters", []) if p],
            "opponent_roster_id": opp_matchup.get("roster_id") if opp_matchup else None,
            "opponent_starters": [p for p in (opp_matchup.get("starters", []) if opp_matchup else []) if p],
        })

    return out
