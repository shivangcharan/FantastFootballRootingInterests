
import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const WEIGHTS = { high: 2, medium: 1, none: 0 };

export default function RootingInterestsApp() {
    const [step, setStep] = useState(1); // 1=username, 2=leagues, 3=players
    const [username, setUsername] = useState("");
    const [week, setWeek] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [leagues, setLeagues] = useState([]); // {league_id, name, importance}
    const [lineups, setLineups] = useState(null); // {leagues:[...], players:{...}}

    const canContinueFromLeagues = useMemo(
        () => leagues.length > 0 && leagues.every((l) => ["high", "medium", "none"].includes(l.importance)),
        [leagues]
    );

    const handleSubmitUsername = async () => {
        setError("");
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/user/${encodeURIComponent(username)}/leagues`);
            if (!res.ok) throw new Error("fetch leagues failed");
            const data = await res.json();
            const withImportance = data.map((lg) => ({ ...lg, importance: "none" }));
            setLeagues(withImportance);
            setStep(2);
        } catch (e) {
            console.error(e);
            setError("Something went wrong, please try again.");
        } finally {
            setLoading(false);
        }
    };

    const toggleImportance = (league_id, level) => {
        setLeagues((prev) =>
            prev.map((lg) => (lg.league_id === league_id ? { ...lg, importance: level } : lg))
        );
    };

    const fetchLineups = async () => {
        setError("");
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/user/${encodeURIComponent(username)}/lineups/${week}`);
            if (!res.ok) throw new Error("fetch lineups failed");
            const data = await res.json();
            setLineups(data);
            setStep(3);
        } catch (e) {
            console.error(e);
            setError("Something went wrong, please try again.");
        } finally {
            setLoading(false);
        }
    };

    const filteredLeagueIds = useMemo(
        () => new Set(leagues.filter((l) => l.importance !== "none").map((l) => l.league_id)),
        [leagues]
    );

    // Build maps for counts and scores
    const { playersIndex, countsFor, countsAgainst, weightedScoreAgainstOnly } = useMemo(() => {
        const idx = new Map(); // pid -> player object
        const forCounts = new Map();
        const againstCounts = new Map();
        const scoreAgainstOnly = new Map(); // only opponent players per spec

        if (!lineups) return { playersIndex: idx, countsFor: forCounts, countsAgainst: againstCounts, weightedScoreAgainstOnly: scoreAgainstOnly };

        // load player index
        Object.values(lineups.players || {}).forEach((p) => {
            idx.set(p.id, p);
        });

        // importance map by league
        const impByLeague = new Map(leagues.map((l) => [l.league_id, l.importance]));

        for (const lg of lineups.leagues || []) {
            const imp = impByLeague.get(lg.league_id) || "none";
            const weight = WEIGHTS[imp];
            if (weight === 0) continue; // ignore none

            // For counts
            for (const pid of lg.my_starters || []) {
                forCounts.set(pid, (forCounts.get(pid) || 0) + 1);
                // score applies positive weight for "for me"
                scoreAgainstOnly.set(pid, (scoreAgainstOnly.get(pid) || 0) + weight);
            }
            for (const pid of lg.opponent_starters || []) {
                againstCounts.set(pid, (againstCounts.get(pid) || 0) + 1);
                // score applies negative weight for "against me"
                scoreAgainstOnly.set(pid, (scoreAgainstOnly.get(pid) || 0) - weight);
            }
        }

        return { playersIndex: idx, countsFor: forCounts, countsAgainst: againstCounts, weightedScoreAgainstOnly: scoreAgainstOnly };
    }, [lineups, leagues]);

    const formatPlayer = (pid) => {
        const p = playersIndex.get(pid);
        if (!p) return pid;
        const team = p.team ? ` ${p.team}` : "";
        const pos = p.position ? ` - ${p.position}` : "";
        return `${p.name}${team}${pos}`;
    };

    // Build a list of ALL relevant players across all filtered leagues (both sides)
    const relevantPlayers = useMemo(() => {
        if (!lineups) return [];
        const set = new Set();
        const impByLeague = new Map(leagues.map((l) => [l.league_id, l.importance]));

        for (const lg of lineups.leagues || []) {
            if ((impByLeague.get(lg.league_id) || "none") === "none") continue;
            (lg.my_starters || []).forEach((pid) => set.add(pid));
            (lg.opponent_starters || []).forEach((pid) => set.add(pid));
        }
        return Array.from(set);
    }, [lineups, leagues]);

    const rootingTable = useMemo(() => {
        // an array of { pid, name, forCount, againstCount }
        return relevantPlayers.map((pid) => ({
            pid,
            name: formatPlayer(pid),
            forCount: countsFor.get(pid) || 0,
            againstCount: countsAgainst.get(pid) || 0,
        })).sort((a, b) => a.name.localeCompare(b.name));
    }, [relevantPlayers, countsFor, countsAgainst]);

    const bottomScores = useMemo(() => {
        // Display rooting interest for every player I'm playing against (weighted sum with +/-)
        const arr = [];
        weightedScoreAgainstOnly.forEach((score, pid) => {
            // Only list players I faced/started against (both are allowed by formula),
            // but per spec "every player I am playing against" — we include all involved players for completeness.
            arr.push({ pid, name: formatPlayer(pid), score });
        });
        return arr.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    }, [weightedScoreAgainstOnly]);

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900">
            <div className="max-w-4xl mx-auto p-6">
                <h1 className="text-3xl font-bold mb-6">Sleeper Rooting Interests</h1>

                {step === 1 && (
                    <div className="bg-white rounded-2xl shadow p-6 space-y-4">
                        <label className="block text-sm font-medium">Sleeper Username</label>
                        <input
                            className="w-full rounded-xl border p-3 focus:outline-none focus:ring"
                            placeholder="e.g. scboom5"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                        <div className="flex gap-3 items-center">
                            <label className="text-sm">Week</label>
                            <input
                                type="number"
                                min={1}
                                max={18}
                                className="w-24 rounded-xl border p-2"
                                value={week}
                                onChange={(e) => setWeek(parseInt(e.target.value || 1))}
                            />
                        </div>
                        <button
                            onClick={handleSubmitUsername}
                            disabled={!username || loading}
                            className="rounded-xl bg-black text-white px-4 py-2 disabled:opacity-50"
                        >
                            {loading ? "Loading..." : "Submit"}
                        </button>
                        {error && <p className="text-red-600 text-sm">{error}</p>}
                    </div>
                )}

                {step === 2 && (
                    <div className="bg-white rounded-2xl shadow p-6 space-y-4">
                        <h2 className="text-xl font-semibold mb-4">Select Importance Per League</h2>
                        <ul className="divide-y">
                            {leagues.map((lg) => (
                                <li key={lg.league_id} className="py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                    <div className="flex flex-col">
                                        <span className="font-medium">{lg.name}</span>
                                        <span className="text-sm text-gray-500">Selected: {lg.importance.toUpperCase()}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        {["high", "medium", "none"].map((lvl) => (
                                            <button
                                                key={lvl}
                                                onClick={() => toggleImportance(lg.league_id, lvl)}
                                                className={
                                                    "px-3 py-1 rounded-full border font-medium " +
                                                    (lg.importance === lvl
                                                        ? lvl === "high"
                                                            ? "bg-green-600 text-white border-green-700"
                                                            : lvl === "medium"
                                                                ? "bg-yellow-500 text-white border-yellow-600"
                                                                : "bg-gray-300 text-gray-700 border-gray-400"
                                                        : "bg-white text-gray-700 border-gray-300")
                                                }
                                                aria-pressed={lg.importance === lvl}
                                            >
                                                {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        <div className="flex justify-end gap-3 mt-4">
                            <button
                                className="px-4 py-2 rounded-xl border"
                                onClick={() => setStep(1)}
                            >
                                Back
                            </button>
                            <button
                                disabled={!canContinueFromLeagues || loading}
                                onClick={fetchLineups}
                                className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-50"
                            >
                                {loading ? "Loading..." : "Continue"}
                            </button>
                        </div>
                        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
                    </div>
                )}


                {step === 3 && lineups && (
                    <div className="space-y-6">
                        <div className="bg-white rounded-2xl shadow p-6 overflow-x-auto">
                            <h2 className="text-xl font-semibold mb-4">Players In Your Matchups</h2>
                            <table className="w-full table-auto border-collapse">
                                <thead>
                                    <tr className="bg-gray-100">
                                        <th className="border p-2 text-left">Player</th>
                                        <th className="border p-2">For me 🟢</th>
                                        <th className="border p-2">Against me 🔴</th>
                                        <th className="border p-2">Rooting Interest 🧠</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bottomScores?.sort((a, b) => b.score - a.score).map(row => {
                                        const forCount = countsFor?.get(row.pid) || 0;
                                        const againstCount = countsAgainst?.get(row.pid) || 0;
                                        const maxScore = Math.max(...bottomScores.map(r => Math.abs(r.score))) || 1;
                                        const normalized = (row.score || 0) / maxScore;

                                        let bgColor = "white";
                                        if (normalized > 0) {
                                            const intensity = Math.floor(255 - normalized * 128);
                                            bgColor = `rgb(${intensity},255,${intensity})`;
                                        } else if (normalized < 0) {
                                            const intensity = Math.floor(255 - Math.abs(normalized) * 128);
                                            bgColor = `rgb(255,${intensity},${intensity})`;
                                        }

                                        return (
                                            <tr key={row.pid} className="border hover:bg-gray-50">
                                                <td className="border p-2 text-black">{row.name}</td>
                                                <td className="border p-2 text-center font-semibold text-black">{forCount}</td>
                                                <td className="border p-2 text-center font-semibold text-black">{againstCount}</td>
                                                <td
                                                    className="border p-2 text-center font-semibold text-black"
                                                    style={{  backgroundColor: bgColor, color: 'black' }}
                                                >
                                                    {row.score}
                                                </td>
                                            </tr>
                                        );

                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-between">
                            <button className="px-4 py-2 rounded-xl border" onClick={() => setStep(2)}>Back</button>
                            <button className="px-4 py-2 rounded-xl border" onClick={() => { setLineups(null); setStep(1); }}>Start Over</button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}