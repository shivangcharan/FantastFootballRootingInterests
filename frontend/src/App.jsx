import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "https://fantastfootballrootinginterests.onrender.com";
const WEIGHTS = { high: 2, medium: 1, none: 0 };

const IMPORTANCE_LEVELS = [
    { key: "high", label: "High", selectedClass: "bg-emerald-600 text-white border-emerald-600 shadow-sm" },
    { key: "medium", label: "Medium", selectedClass: "bg-amber-500 text-white border-amber-500 shadow-sm" },
    { key: "none", label: "None", selectedClass: "bg-gray-500 text-white border-gray-500 shadow-sm" },
];

const STEPS = [
    { id: 1, label: "Username" },
    { id: 2, label: "Leagues" },
    { id: 3, label: "Results" },
];

function Spinner() {
    return (
        <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white align-[-2px]"
            aria-hidden="true"
        />
    );
}

function StepIndicator({ step }) {
    return (
        <ol className="mb-6 flex items-center justify-center gap-2 sm:gap-4">
            {STEPS.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-2">
                        <span
                            className={
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors " +
                                (step === s.id
                                    ? "bg-indigo-600 text-white"
                                    : step > s.id
                                        ? "bg-indigo-100 text-indigo-600"
                                        : "bg-gray-100 text-gray-400")
                            }
                        >
                            {step > s.id ? "✓" : s.id}
                        </span>
                        <span
                            className={
                                "hidden text-sm font-medium sm:inline " +
                                (step === s.id ? "text-gray-900" : "text-gray-400")
                            }
                        >
                            {s.label}
                        </span>
                    </div>
                    {i < STEPS.length - 1 && <span className="h-px w-6 bg-gray-200 sm:w-10" />}
                </li>
            ))}
        </ol>
    );
}

function ErrorBanner({ message }) {
    if (!message) return null;
    return (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {message}
        </div>
    );
}

function formatKickoff(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    });
}

function RootingCategoryCard({ title, emoji, players, emptyText, badgeClass, badgeStyleFor }) {
    return (
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-900/5">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <span aria-hidden="true">{emoji}</span> {title}
            </h3>
            {players.length === 0 ? (
                <p className="py-2 text-sm text-gray-400">{emptyText}</p>
            ) : (
                <ul className="space-y-1.5">
                    {players.map((p) => (
                        <li key={p.pid} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-sm text-gray-700">{p.name}</span>
                            <span
                                className={"shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold " + (badgeClass || "")}
                                style={badgeStyleFor ? badgeStyleFor(p.score) : undefined}
                            >
                                {p.score}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function RootingInterestsApp() {
    const [step, setStep] = useState(1); // 1=username, 2=leagues, 3=players
    const [username, setUsername] = useState("");
    const [week, setWeek] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [leagues, setLeagues] = useState([]); // {league_id, name, importance}
    const [lineups, setLineups] = useState(null); // {leagues:[...], players:{...}}
    const [schedule, setSchedule] = useState([]); // [{game_id, home, away, kickoff}]

    // Prefill the week with the current NFL week, but only if the user hasn't
    // already typed their own value in (a ref, not state, so the async
    // response can't clobber an edit that happened while it was in flight).
    const weekEditedRef = useRef(false);
    useEffect(() => {
        fetch(`${API_BASE}/nfl/state`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                const current = data?.week;
                if (!weekEditedRef.current && Number.isInteger(current) && current >= 1 && current <= 18) {
                    setWeek(current);
                }
            })
            .catch(() => {});
    }, []);

    const canContinueFromLeagues = useMemo(
        () => leagues.length > 0 && leagues.every((l) => ["high", "medium", "none"].includes(l.importance)),
        [leagues]
    );

    const selectedCount = useMemo(
        () => leagues.filter((l) => l.importance !== "none").length,
        [leagues]
    );

    const handleWeekChange = (raw) => {
        weekEditedRef.current = true;
        if (raw === "") {
            setWeek("");
            return;
        }
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) return;
        setWeek(Math.min(18, Math.max(1, parsed)));
    };

    const handleSubmitUsername = async (e) => {
        e?.preventDefault?.();
        if (!username || loading) return;
        setError("");
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/user/${encodeURIComponent(username.trim())}/leagues`);
            if (!res.ok) throw new Error("fetch leagues failed");
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
                setError("No leagues found for that username this season.");
                return;
            }
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
        if (!canContinueFromLeagues || loading) return;
        setError("");
        setLoading(true);
        try {
            // Schedule is a nice-to-have (game times) - fetch it alongside lineups
            // but never let it block or fail the primary lineups request.
            const [res, scheduleData] = await Promise.all([
                fetch(`${API_BASE}/user/${encodeURIComponent(username.trim())}/lineups/${week}`),
                fetch(`${API_BASE}/nfl/schedule/${week}`)
                    .then((r) => (r.ok ? r.json() : []))
                    .catch(() => []),
            ]);
            if (!res.ok) throw new Error("fetch lineups failed");
            const data = await res.json();
            setLineups(data);
            setSchedule(Array.isArray(scheduleData) ? scheduleData : []);
            setStep(3);
        } catch (e) {
            console.error(e);
            setError("Something went wrong, please try again.");
        } finally {
            setLoading(false);
        }
    };

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

    // Rooting scores, sorted once (descending) and with maxScore computed a single time
    // instead of recomputing Math.max over the whole array on every row render.
    const { rows, maxAbsScore } = useMemo(() => {
        const arr = relevantPlayers.map((pid) => {
            const score = weightedScoreAgainstOnly.get(pid) || 0;
            return {
                pid,
                name: formatPlayer(pid),
                forCount: countsFor.get(pid) || 0,
                againstCount: countsAgainst.get(pid) || 0,
                score,
            };
        });
        arr.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        const maxAbs = arr.reduce((max, r) => Math.max(max, Math.abs(r.score)), 0) || 1;
        return { rows: arr, maxAbsScore: maxAbs };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [relevantPlayers, countsFor, countsAgainst, weightedScoreAgainstOnly]);

    // rows is already sorted by score descending, so filtering preserves that order.
    const { heroes, villains, conflicts } = useMemo(() => ({
        heroes: rows.filter((r) => r.forCount >= 2 && r.againstCount === 0),
        villains: rows.filter((r) => r.againstCount >= 2 && r.forCount === 0),
        conflicts: rows.filter((r) => r.forCount >= 1 && r.againstCount >= 1),
    }), [rows]);

    // Real-world NFL games for the week, ranked by how much rooting interest
    // is riding on them: sum of |rooting interest| across every relevant
    // player on either team (so both "lots of players" and "high stakes
    // players" push a game up), not just a raw headcount.
    const gameRows = useMemo(() => {
        if (!schedule.length) return [];
        const byTeam = new Map();
        rows.forEach((r) => {
            const team = playersIndex.get(r.pid)?.team;
            if (!team) return;
            if (!byTeam.has(team)) byTeam.set(team, []);
            byTeam.get(team).push(r);
        });

        const games = schedule.map((g) => {
            const players = [...(byTeam.get(g.home) || []), ...(byTeam.get(g.away) || [])]
                .sort((a, b) => b.score - a.score);
            const weight = players.reduce((sum, p) => sum + Math.abs(p.score), 0);
            return { ...g, players, weight };
        });

        games.sort((a, b) => b.weight - a.weight || new Date(a.kickoff) - new Date(b.kickoff));
        return games;
    }, [schedule, rows, playersIndex]);

    const scoreStyle = (score) => {
        const normalized = score / maxAbsScore;
        if (normalized === 0) return { backgroundColor: "#f9fafb", color: "#111827" };
        if (normalized > 0) {
            const intensity = Math.round(255 - normalized * 128);
            return { backgroundColor: `rgb(${intensity},255,${intensity})`, color: "#111827" };
        }
        const intensity = Math.round(255 - Math.abs(normalized) * 128);
        return { backgroundColor: `rgb(255,${intensity},${intensity})`, color: "#111827" };
    };

    const resetAll = () => {
        setLineups(null);
        setSchedule([]);
        setLeagues([]);
        setUsername("");
        setStep(1);
    };

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900">
            <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
                <header className="mb-6 text-center">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">🏈 Sleeper Rooting Interests</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Find out who to root for across all your fantasy leagues.
                    </p>
                </header>

                <StepIndicator step={step} />

                {step === 1 && (
                    <form
                        onSubmit={handleSubmitUsername}
                        className="space-y-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-900/5 sm:p-6"
                    >
                        <div>
                            <label htmlFor="username" className="mb-1 block text-sm font-medium text-gray-700">
                                Sleeper Username
                            </label>
                            <input
                                id="username"
                                className="w-full rounded-xl border border-gray-300 p-3 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                                placeholder="e.g. scboom5"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div>
                            <label htmlFor="week" className="mb-1 block text-sm font-medium text-gray-700">
                                Week
                            </label>
                            <input
                                id="week"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={18}
                                className="w-24 rounded-xl border border-gray-300 p-3 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                                value={week}
                                onChange={(e) => handleWeekChange(e.target.value)}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={!username || loading}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                            {loading && <Spinner />}
                            {loading ? "Loading..." : "Find My Leagues"}
                        </button>

                        <ErrorBanner message={error} />
                    </form>
                )}

                {step === 2 && (
                    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-900/5 sm:p-6">
                        <div className="mb-4 flex items-center justify-between gap-2">
                            <h2 className="text-lg font-semibold sm:text-xl">Select Importance Per League</h2>
                            <span className="whitespace-nowrap rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                                {selectedCount} selected
                            </span>
                        </div>

                        <ul className="space-y-3">
                            {leagues.map((lg) => (
                                <li
                                    key={lg.league_id}
                                    className="rounded-xl border border-gray-200 p-3 transition sm:p-4"
                                >
                                    <div className="mb-3 font-medium text-gray-900">{lg.name}</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {IMPORTANCE_LEVELS.map(({ key, label, selectedClass }) => {
                                            const selected = lg.importance === key;
                                            return (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={() => toggleImportance(lg.league_id, key)}
                                                    aria-pressed={selected}
                                                    className={
                                                        "min-h-[44px] rounded-lg border px-2 py-2 text-sm font-medium transition active:scale-[0.97] " +
                                                        (selected
                                                            ? selectedClass
                                                            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50")
                                                    }
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                className="rounded-xl border border-gray-300 px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-50 sm:py-2"
                                onClick={() => setStep(1)}
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                disabled={!canContinueFromLeagues || loading}
                                onClick={fetchLineups}
                                className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 sm:py-2"
                            >
                                {loading && <Spinner />}
                                {loading ? "Loading..." : "Continue"}
                            </button>
                        </div>
                        <ErrorBanner message={error} />
                    </div>
                )}

                {step === 3 && lineups && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <RootingCategoryCard
                                title="Heroes"
                                emoji="🦸"
                                players={heroes}
                                emptyText="No multi-league heroes yet."
                                badgeClass="bg-emerald-50 text-emerald-700"
                            />
                            <RootingCategoryCard
                                title="Villains"
                                emoji="🦹"
                                players={villains}
                                emptyText="No multi-league villains yet."
                                badgeClass="bg-red-50 text-red-600"
                            />
                            <RootingCategoryCard
                                title="Conflicts"
                                emoji="⚔️"
                                players={conflicts}
                                emptyText="No conflicted players yet."
                                badgeStyleFor={scoreStyle}
                            />
                        </div>

                        {gameRows.length > 0 && (
                            <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-900/5 sm:p-6">
                                <h2 className="mb-4 text-lg font-semibold sm:text-xl">Matchups of the Week</h2>
                                <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                                    {gameRows.map((g) => (
                                        <div
                                            key={g.game_id}
                                            className="w-60 shrink-0 snap-start rounded-xl border border-gray-200 p-3"
                                        >
                                            <div className="font-semibold text-gray-900">
                                                {g.away} @ {g.home}
                                            </div>
                                            <div className="mt-0.5 text-xs text-gray-500">{formatKickoff(g.kickoff)}</div>

                                            {g.players.length === 0 ? (
                                                <p className="mt-3 text-xs text-gray-400">No rooting interest in this game.</p>
                                            ) : (
                                                <ul className="mt-3 space-y-1.5">
                                                    {g.players.map((p) => (
                                                        <li key={p.pid} className="flex items-center justify-between gap-2">
                                                            <span className="min-w-0 truncate text-xs text-gray-700">{p.name}</span>
                                                            <span
                                                                className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                                                                style={scoreStyle(p.score)}
                                                            >
                                                                {p.score}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-900/5 sm:p-6">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-lg font-semibold sm:text-xl">Players In Your Matchups</h2>
                                <span className="text-xs text-gray-500">Week {week}</span>
                            </div>

                            {rows.length === 0 ? (
                                <p className="py-8 text-center text-sm text-gray-500">
                                    No relevant players found for your selected leagues.
                                </p>
                            ) : (
                                <>
                                    {/* Mobile: card list */}
                                    <ul className="divide-y divide-gray-100 sm:hidden">
                                        {rows.map((row) => (
                                            <li key={row.pid} className="flex items-center justify-between gap-3 py-3">
                                                <div className="min-w-0">
                                                    <div className="truncate font-medium text-gray-900">{row.name}</div>
                                                    <div className="mt-0.5 text-xs text-gray-500">
                                                        <span className="text-emerald-600">🟢 {row.forCount}</span>
                                                        {"  "}
                                                        <span className="text-red-500">🔴 {row.againstCount}</span>
                                                    </div>
                                                </div>
                                                <div
                                                    className="shrink-0 rounded-lg px-3 py-1.5 text-center text-sm font-semibold"
                                                    style={scoreStyle(row.score)}
                                                >
                                                    {row.score}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>

                                    {/* Desktop: table */}
                                    <div className="hidden overflow-x-auto sm:block">
                                        <table className="w-full table-auto border-collapse text-sm">
                                            <thead>
                                                <tr className="bg-gray-100">
                                                    <th className="rounded-l-lg p-2 text-left">Player</th>
                                                    <th className="p-2">For me 🟢</th>
                                                    <th className="p-2">Against me 🔴</th>
                                                    <th className="rounded-r-lg p-2">Rooting Interest 🧠</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((row) => (
                                                    <tr key={row.pid} className="border-b border-gray-100 hover:bg-gray-50">
                                                        <td className="p-2 text-gray-900">{row.name}</td>
                                                        <td className="p-2 text-center font-semibold text-gray-900">{row.forCount}</td>
                                                        <td className="p-2 text-center font-semibold text-gray-900">{row.againstCount}</td>
                                                        <td
                                                            className="rounded-lg p-2 text-center font-semibold"
                                                            style={scoreStyle(row.score)}
                                                        >
                                                            {row.score}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="flex justify-between gap-3">
                            <button
                                className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                                onClick={() => setStep(2)}
                            >
                                Back
                            </button>
                            <button
                                className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                                onClick={resetAll}
                            >
                                Start Over
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
