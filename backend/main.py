
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from concurrent.futures import ThreadPoolExecutor
import requests
import datetime
import time

BASE_URL = "https://api.sleeper.app/v1"
ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
PLAYERS_CACHE_TTL_SECONDS = 6 * 60 * 60  # Sleeper only updates this dataset a few times a day
ROSTERS_CACHE_TTL_SECONDS = 2 * 60  # short-lived: a user typically hits /leagues then /lineups within seconds
NFL_STATE_CACHE_TTL_SECONDS = 15 * 60
SCHEDULE_CACHE_TTL_SECONDS = 30 * 60

# ESPN uses a couple of team abbreviations that differ from Sleeper's.
ESPN_TO_SLEEPER_TEAM = {"WSH": "WAS"}

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"]
    ,allow_headers=["*"]
)


@app.api_route("/", methods=["GET", "HEAD"])
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



# A user typically fetches /leagues (to build the importance-selection screen)
# and then /lineups moments later for the same leagues, both of which need
# each league's rosters. Cache rosters per-league briefly so that round trip
# doesn't hit Sleeper twice for the same data.
_rosters_cache = {}  # league_id -> {"data": [...], "fetched_at": ts}


def get_rosters(league_id: str):
    now = time.time()
    cached = _rosters_cache.get(league_id)
    if cached is not None and (now - cached["fetched_at"]) < ROSTERS_CACHE_TTL_SECONDS:
        return cached["data"]

    r = requests.get(f"{BASE_URL}/league/{league_id}/rosters")
    r.raise_for_status()
    data = r.json()
    _rosters_cache[league_id] = {"data": data, "fetched_at": now}
    return data


def get_matchups(league_id: str, week: int):
    r = requests.get(f"{BASE_URL}/league/{league_id}/matchups/{week}")
    r.raise_for_status()
    return r.json()


def find_my_roster_id(rosters: list, user_id: str):
    """A league can list users as a co_owner of someone else's roster - being a
    view-only member (invited to the league but with no roster of your own)
    does not count. Only owners and co-owners have a real team to root for.
    """
    for r in rosters:
        if r.get("owner_id") == user_id:
            return r.get("roster_id")
        if user_id in (r.get("co_owners") or []):
            return r.get("roster_id")
    return None


# The /players/nfl endpoint returns the ENTIRE NFL player dictionary (several
# thousand players, multiple MB of JSON). Sleeper's docs explicitly recommend
# calling this at most once every few hours and caching the result, since it
# barely changes. Previously this was re-fetched from scratch on every single
# /lineups request, which was by far the biggest source of latency in this app.
_players_cache = {"data": None, "fetched_at": 0}


def get_players():
    now = time.time()
    if _players_cache["data"] is not None and (now - _players_cache["fetched_at"]) < PLAYERS_CACHE_TTL_SECONDS:
        return _players_cache["data"]

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

    _players_cache["data"] = players
    _players_cache["fetched_at"] = now
    return players


def build_league_matchup(lg: dict, user_id: str, week: int):
    """Fetch rosters + matchups for a single league and shape the response entry.
    Returns None if the user isn't in this league's matchup for the given week.
    """
    league_id = lg["league_id"]
    name = lg.get("name", "Unnamed League")

    rosters = get_rosters(league_id)
    my_roster_id = find_my_roster_id(rosters, user_id)
    if my_roster_id is None:
        return None

    matchups = get_matchups(league_id, week)

    my_matchup, opp_matchup = None, None
    for m in matchups:
        if m.get("roster_id") == my_roster_id:
            my_matchup = m
            mid = m.get("matchup_id")
            # A missing matchup_id means a bye week - there's no real opponent.
            if mid is not None:
                for o in matchups:
                    if o.get("matchup_id") == mid and o.get("roster_id") != my_roster_id:
                        opp_matchup = o
                        break
            break

    if my_matchup is None:
        return None

    # Sleeper represents an empty starter slot as the literal string "0"
    # (not null/empty), so a plain truthiness check doesn't filter it out.
    empty_slots = (None, "0")
    return {
        "league_id": league_id,
        "name": name,
        "my_roster_id": my_roster_id,
        "my_starters": [p for p in my_matchup.get("starters", []) if p not in empty_slots],
        "opponent_roster_id": opp_matchup.get("roster_id") if opp_matchup else None,
        "opponent_starters": [p for p in (opp_matchup.get("starters", []) if opp_matchup else []) if p not in empty_slots],
    }


_schedule_cache = {}  # (week, season) -> {"data": [...], "fetched_at": ts}


def get_nfl_schedule(week: int, season: int):
    key = (week, season)
    now = time.time()
    cached = _schedule_cache.get(key)
    if cached is not None and (now - cached["fetched_at"]) < SCHEDULE_CACHE_TTL_SECONDS:
        return cached["data"]

    r = requests.get(ESPN_SCOREBOARD_URL, params={"week": week, "seasontype": 2, "year": season})
    r.raise_for_status()
    data = r.json()

    games = []
    for event in data.get("events", []):
        competitions = event.get("competitions") or []
        comp = competitions[0] if competitions else {}
        kickoff = comp.get("date") or event.get("date")
        home = away = None
        for c in comp.get("competitors", []):
            abbr = (c.get("team") or {}).get("abbreviation")
            abbr = ESPN_TO_SLEEPER_TEAM.get(abbr, abbr)
            if c.get("homeAway") == "home":
                home = abbr
            elif c.get("homeAway") == "away":
                away = abbr
        if home and away and kickoff:
            games.append({"game_id": event.get("id"), "home": home, "away": away, "kickoff": kickoff})

    _schedule_cache[key] = {"data": games, "fetched_at": now}
    return games


_nfl_state_cache = {"data": None, "fetched_at": 0}


@app.get("/nfl/state")
def api_nfl_state():
    now = time.time()
    if _nfl_state_cache["data"] is not None and (now - _nfl_state_cache["fetched_at"]) < NFL_STATE_CACHE_TTL_SECONDS:
        return _nfl_state_cache["data"]

    r = requests.get(f"{BASE_URL}/state/nfl")
    r.raise_for_status()
    state = r.json()
    result = {"week": state.get("week"), "season": state.get("season"), "season_type": state.get("season_type")}
    _nfl_state_cache["data"] = result
    _nfl_state_cache["fetched_at"] = now
    return result


@app.get("/nfl/schedule/{week}")
def api_nfl_schedule(week: int, season: int | None = None):
    if season is None:
        season = datetime.datetime.now().year
    return get_nfl_schedule(week, season)


@app.get("/user/{username}/leagues")
def api_leagues(username: str, season: int | None = None):
    if season is None:
        season = datetime.datetime.now().year
    user = get_user(username)
    user_id = user["user_id"]
    leagues = get_leagues(user_id, season)

    # A user can be a league member (e.g. invited as a viewer/co-manager
    # placeholder) without actually owning or co-owning a roster. Those
    # leagues have nothing to root for, so exclude them here rather than
    # showing them as a selectable-but-useless option.
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(leagues)))) as pool:
        rosters_by_league = dict(zip(
            (lg["league_id"] for lg in leagues),
            pool.map(get_rosters, (lg["league_id"] for lg in leagues)),
        ))

    return [
        {"league_id": lg["league_id"], "name": lg.get("name", "Unnamed League")}
        for lg in leagues
        if find_my_roster_id(rosters_by_league[lg["league_id"]], user_id) is not None
    ]


@app.get("/user/{username}/lineups/{week}")
def api_lineups(username: str, week: int, season: int | None = None):
    if season is None:
        season = datetime.datetime.now().year

    user = get_user(username)
    user_id = user["user_id"]
    leagues = get_leagues(user_id, season)

    # Each league requires its own roster + matchup lookups against Sleeper's
    # API. These are independent of one another, so fetch them concurrently
    # instead of one-by-one - this scales much better for users in many leagues.
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(leagues)))) as pool:
        players_future = pool.submit(get_players)
        league_futures = [pool.submit(build_league_matchup, lg, user_id, week) for lg in leagues]
        results = [f.result() for f in league_futures]
        players = players_future.result()

    out = {
        "leagues": [entry for entry in results if entry is not None],
        "players": players,
    }
    return out
