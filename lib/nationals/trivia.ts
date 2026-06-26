/** Redemption Nationals History — trivia question generation (pure, no DOM). */

import { shuffle } from "@/lib/nationals/format";
import type { NationalsData, FantasyDraft } from "@/lib/nationals/types";

// ── Question shape ────────────────────────────────────────────────────────────

export interface Question {
  q: string;
  correct: string;
  options: string[];
}

// ── FantasyDraft picks type (extended, not in shared types) ───────────────────

interface FantasyPick {
  round: number;
  pick: number;
  gm: string;
  player: string;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildTriviaQuestions(seed: NationalsData): Question[] {
  const qs: Question[] = [];
  const tournaments = seed.tournaments.filter((t) => t.location);
  const allResults = seed.results;
  const allMatches = seed.matches;
  const FULL_THRESH = 3;

  function winners(key: string): string[] {
    return (allResults[key] || [])
      .filter((r) => r.placement === 1)
      .map((r) => r.playerName);
  }

  function allWinners(): string[] {
    const s = new Set<string>();
    Object.values(allResults).forEach((rs) => {
      const w = rs.find((r) => r.placement === 1);
      if (w) s.add(w.playerName);
    });
    return Array.from(s);
  }

  // ── Location / year ─────────────────────────────────────────────────────────
  tournaments.forEach((t) => {
    if (!t.location) return;
    const wrong = shuffle(
      [...new Set(
        tournaments
          .filter((x) => x.id !== t.id && x.location && x.location !== t.location)
          .map((x) => x.location)
      )]
    ).slice(0, 3);
    if (wrong.length < 3) return;
    qs.push({
      q: `Where was the ${t.year} Nationals held?`,
      correct: t.location,
      options: shuffle([t.location, ...wrong]),
    });
    const yWrong = shuffle(
      tournaments
        .filter((x) => x.id !== t.id && String(x.year) !== String(t.year))
        .map((x) => String(x.year))
    ).slice(0, 3);
    if (yWrong.length >= 3)
      qs.push({
        q: `What year was Nationals held in ${t.location.split(",")[0]}?`,
        correct: String(t.year),
        options: shuffle([String(t.year), ...yWrong]),
      });
  });

  // ── Venue ────────────────────────────────────────────────────────────────────
  tournaments
    .filter((t) => t.venue)
    .forEach((t) => {
      const wrong = shuffle(
        [...new Set(
          tournaments
            .filter((x) => x.id !== t.id && x.venue && x.venue !== t.venue)
            .map((x) => x.venue)
        )]
      ).slice(0, 3);
      if (wrong.length < 3) return;
      qs.push({
        q: `What was the venue for the ${t.year} Nationals?`,
        correct: t.venue,
        options: shuffle([t.venue, ...wrong]),
      });
    });

  // ── Host ─────────────────────────────────────────────────────────────────────
  tournaments
    .filter((t) => t.notes && t.notes.includes("Host:"))
    .forEach((t) => {
      const hm = t.notes.match(/Host:\s*([^.(]+)/);
      if (!hm) return;
      const host = hm[1].trim();
      const wrong = shuffle(
        [...new Set(
          tournaments
            .filter((x) => x.id !== t.id && x.notes && x.notes.includes("Host:"))
            .map((x) => {
              const m = x.notes.match(/Host:\s*([^.(]+)/);
              return m ? m[1].trim() : null;
            })
            .filter((v): v is string => v !== null && v !== host)
        )]
      ).slice(0, 3);
      if (wrong.length < 3) return;
      qs.push({
        q: `Who hosted the ${t.year} Nationals?`,
        correct: host,
        options: shuffle([host, ...wrong]),
      });
    });

  // ── Attendance ───────────────────────────────────────────────────────────────
  const withAtt = tournaments.filter((t) => t.attendance);
  if (withAtt.length >= 4) {
    withAtt.forEach((t) => {
      const wrong = shuffle(
        [...new Set(
          withAtt
            .filter((x) => x.id !== t.id && x.attendance !== t.attendance)
            .map((x) => String(x.attendance))
        )]
      ).slice(0, 3);
      if (wrong.length < 3) return;
      qs.push({
        q: `How many players attended the ${t.year} Nationals?`,
        correct: String(t.attendance),
        options: shuffle([String(t.attendance), ...wrong]),
      });
    });
    const maxT = withAtt.reduce((a, b) => (a.attendance! > b.attendance! ? a : b));
    const minT = withAtt.reduce((a, b) => (a.attendance! < b.attendance! ? a : b));
    const topOpts = shuffle(
      withAtt
        .slice()
        .sort((a, b) => b.attendance! - a.attendance!)
        .slice(0, 4)
        .map((t) => String(t.year))
    );
    if (topOpts.length >= 4)
      qs.push({
        q: `Which Nationals had the highest recorded attendance?`,
        correct: String(maxT.year),
        options: topOpts,
      });
    const botOpts = shuffle(
      withAtt
        .slice()
        .sort((a, b) => a.attendance! - b.attendance!)
        .slice(0, 4)
        .map((t) => String(t.year))
    );
    if (botOpts.length >= 4)
      qs.push({
        q: `Which Nationals had the lowest recorded attendance?`,
        correct: String(minT.year),
        options: botOpts,
      });
  }

  // ── Promo cards ──────────────────────────────────────────────────────────────
  tournaments
    .filter((t) => t.notes && t.notes.includes("Promo:"))
    .forEach((t) => {
      const pm = t.notes.match(/Promo:\s*([^.]+)/);
      if (!pm) return;
      const promo = pm[1].trim();
      if (promo.toLowerCase() === "none") return;
      const wrong = shuffle(
        tournaments
          .filter((x) => x.id !== t.id && x.notes && x.notes.includes("Promo:"))
          .map((x) => {
            const m = x.notes.match(/Promo:\s*([^.]+)/);
            return m && m[1].trim().toLowerCase() !== "none" ? m[1].trim() : null;
          })
          .filter((v): v is string => v !== null && v !== promo)
      ).slice(0, 3);
      if (wrong.length < 3) return;
      qs.push({
        q: `What was the promo card at the ${t.year} Nationals?`,
        correct: promo,
        options: shuffle([promo, ...wrong]),
      });
      const yOpts = shuffle([
        String(t.year),
        ...shuffle(
          tournaments.filter((x) => x.id !== t.id).map((x) => String(x.year))
        ).slice(0, 3),
      ]);
      qs.push({
        q: `The promo "${promo}" was given at which Nationals?`,
        correct: String(t.year),
        options: yOpts.slice(0, 4),
      });
    });

  // ── Trivia tidbits from notes ─────────────────────────────────────────────────
  tournaments
    .filter((t) => t.notes && t.notes.includes("Trivia:"))
    .forEach((t) => {
      const tm = t.notes.match(/Trivia:\s*(.+?)(?:\.|$)/);
      if (!tm) return;
      const fact = tm[1].trim();
      const yWrong = shuffle(
        tournaments.filter((x) => x.id !== t.id).map((x) => String(x.year))
      ).slice(0, 3);
      if (yWrong.length >= 3)
        qs.push({
          q: `"${fact}" — which year's Nationals does this describe?`,
          correct: String(t.year),
          options: shuffle([String(t.year), ...yWrong]),
        });
    });

  // ── State/region ──────────────────────────────────────────────────────────────
  const stateCount: Record<string, number> = {};
  tournaments.forEach((t) => {
    const m = (t.location || "").match(/,\s*([A-Z]{2})\s*$/);
    if (m) stateCount[m[1]] = (stateCount[m[1]] || 0) + 1;
  });
  const multiState = Object.entries(stateCount).filter(([, c]) => c > 1);
  if (multiState.length >= 2) {
    const topState = multiState.reduce((a, b) => (b[1] > a[1] ? b : a));
    const stateOpts = shuffle(multiState.slice(0, 4).map(([s]) => s));
    if (stateOpts.length >= 4)
      qs.push({
        q: `Which state has hosted Nationals the most times?`,
        correct: topState[0],
        options:
          stateOpts.length >= 4
            ? stateOpts
            : shuffle([
                topState[0],
                ...Object.keys(stateCount)
                  .filter((s) => s !== topState[0])
                  .slice(0, 3),
              ]),
      });
    multiState.forEach(([st, count]) => {
      const countOpts = shuffle(
        [...new Set([count, count - 1, count + 1, count + 2])].filter((n) => n > 0)
      )
        .slice(0, 4)
        .map(String);
      if (!countOpts.includes(String(count))) countOpts[0] = String(count);
      if (countOpts.length >= 4)
        qs.push({
          q: `How many times has Nationals been held in ${st}?`,
          correct: String(count),
          options: shuffle(countOpts.slice(0, 4)),
        });
    });
  }

  // ── Winner questions ──────────────────────────────────────────────────────────
  const allW = allWinners();
  Object.entries(allResults).forEach(([key, results]) => {
    const u = key.indexOf("_");
    const year = parseInt(key.slice(0, u));
    const fmt = key.slice(u + 1);
    if (results.length <= FULL_THRESH) return;
    const winner = results.find((r) => r.placement === 1);
    if (!winner || !winner.playerName) return;
    const wrong = shuffle(allW.filter((n) => n !== winner.playerName)).slice(0, 3);
    if (wrong.length < 3) return;
    qs.push({
      q: `Who won ${fmt} at the ${year} Nationals?`,
      correct: winner.playerName,
      options: shuffle([winner.playerName, ...wrong]),
    });
  });

  // ── Runner-up / 3rd place ─────────────────────────────────────────────────────
  Object.entries(allResults).forEach(([key, results]) => {
    const u = key.indexOf("_");
    const year = parseInt(key.slice(0, u));
    const fmt = key.slice(u + 1);
    if (results.length <= FULL_THRESH) return;
    [2, 3].forEach((pl) => {
      const p = results.find((r) => r.placement === pl);
      if (!p || !p.playerName) return;
      const wrong = shuffle(
        [...new Set(
          results
            .filter(
              (r) =>
                r.placement &&
                r.placement > pl &&
                r.playerName &&
                r.playerName !== p.playerName
            )
            .map((r) => r.playerName)
        )]
      ).slice(0, 3);
      if (wrong.length < 3) return;
      const label = pl === 2 ? "runner-up" : "3rd place";
      qs.push({
        q: `Who finished ${label} in ${fmt} at the ${year} Nationals?`,
        correct: p.playerName,
        options: shuffle([p.playerName, ...wrong]),
      });
    });
  });

  // ── Top cut bracket ───────────────────────────────────────────────────────────
  Object.entries(allMatches).forEach(([key, matches]) => {
    const u = key.indexOf("_");
    const year = parseInt(key.slice(0, u));
    const fmt = key.slice(u + 1);
    const finals = matches.filter((m) => m.topCut && m.round === "Final" && m.winner);
    const semis = matches.filter(
      (m) => m.topCut && m.round === "Semifinal" && m.winner
    );
    const semiWinners = new Set(semis.map((m) => m.winner).filter(Boolean));
    const champMatch = finals.find(
      (m) => semiWinners.has(m.playerA) && semiWinners.has(m.playerB)
    );
    if (champMatch) {
      const champ = champMatch.winner;
      const loser =
        champMatch.playerA === champ ? champMatch.playerB : champMatch.playerA;
      const wrong = shuffle(allW.filter((n) => n !== loser && n !== champ)).slice(0, 3);
      if (wrong.length >= 3)
        qs.push({
          q: `Who did ${champ} defeat in the championship match at ${year} Nationals (${fmt})?`,
          correct: loser,
          options: shuffle([loser, ...wrong]),
        });
      const semiLosers = semis
        .map((m) => ({
          winner: m.winner,
          loser: m.playerA === m.winner ? m.playerB : m.playerA,
        }))
        .filter((x) => x.loser);
      semiLosers.forEach(({ winner, loser }) => {
        const w2 = shuffle(allW.filter((n) => n !== loser && n !== winner)).slice(0, 3);
        if (w2.length >= 3)
          qs.push({
            q: `Who defeated ${loser} in the semifinals at ${year} Nationals (${fmt})?`,
            correct: winner,
            options: shuffle([winner, ...w2]),
          });
      });
    }
  });

  // ── Career / all-time stat questions ──────────────────────────────────────────
  // Title counts per player
  const titlesByPlayer: Record<string, { total: number; byFmt: Record<string, number> }> =
    {};
  Object.entries(allResults).forEach(([key, results]) => {
    const u = key.indexOf("_");
    const fmt = key.slice(u + 1);
    if (results.length <= FULL_THRESH) return;
    const w = results.find((r) => r.placement === 1);
    if (!w || !w.playerName) return;
    if (!titlesByPlayer[w.playerName])
      titlesByPlayer[w.playerName] = { total: 0, byFmt: {} };
    titlesByPlayer[w.playerName].total++;
    titlesByPlayer[w.playerName].byFmt[fmt] =
      (titlesByPlayer[w.playerName].byFmt[fmt] || 0) + 1;
  });
  const byTotal = Object.entries(titlesByPlayer).sort(
    (a, b) => b[1].total - a[1].total
  );
  if (byTotal.length >= 4) {
    const top = byTotal[0];
    const opts = shuffle(byTotal.slice(0, 6).map((x) => x[0])).slice(0, 4);
    if (!opts.includes(top[0])) opts[0] = top[0];
    qs.push({
      q: `Which player has won the most Nationals titles overall?`,
      correct: top[0],
      options: opts,
    });
    qs.push({
      q: `How many total Nationals titles does ${top[0]} have?`,
      correct: String(top[1].total),
      options: shuffle(
        [
          ...new Set([
            top[1].total,
            top[1].total - 1,
            byTotal[1][1].total,
            byTotal[2][1].total,
          ]),
        ].map(String)
      ).slice(0, 4),
    });
  }

  // Most titles in specific format
  const fmtTitles: Record<string, { name: string; count: number }[]> = {};
  Object.entries(titlesByPlayer).forEach(([name, data]) => {
    Object.entries(data.byFmt).forEach(([fmt, count]) => {
      if (count >= 2) {
        if (!fmtTitles[fmt]) fmtTitles[fmt] = [];
        fmtTitles[fmt].push({ name, count });
      }
    });
  });
  Object.entries(fmtTitles).forEach(([fmt, players]) => {
    players.sort((a, b) => b.count - a.count);
    const top = players[0];
    const wrong = shuffle(allW.filter((n) => n !== top.name)).slice(0, 3);
    if (wrong.length >= 3)
      qs.push({
        q: `Which player has won ${fmt} at Nationals the most times?`,
        correct: top.name,
        options: shuffle([top.name, ...wrong]),
      });
  });

  // Back-to-back winners
  const yearsSorted = Object.keys(allResults)
    .map((k) => {
      const u = k.indexOf("_");
      return { yr: parseInt(k.slice(0, u)), fmt: k.slice(u + 1), key: k };
    })
    .sort((a, b) => a.yr - b.yr);
  const fmtYears: Record<string, { yr: number; key: string }[]> = {};
  yearsSorted.forEach(({ yr, fmt, key }) => {
    if (!fmtYears[fmt]) fmtYears[fmt] = [];
    fmtYears[fmt].push({ yr, key });
  });
  Object.entries(fmtYears).forEach(([fmt, yks]) => {
    for (let i = 1; i < yks.length; i++) {
      if (yks[i].yr - yks[i - 1].yr !== 1) continue;
      const w1 = allResults[yks[i - 1].key]?.find((r) => r.placement === 1)?.playerName;
      const w2 = allResults[yks[i].key]?.find((r) => r.placement === 1)?.playerName;
      if (w1 && w2 && w1 === w2) {
        const wrong = shuffle(allW.filter((n) => n !== w1)).slice(0, 3);
        if (wrong.length >= 3)
          qs.push({
            q: `Who won ${fmt} back-to-back in ${yks[i - 1].yr} and ${yks[i].yr}?`,
            correct: w1,
            options: shuffle([w1, ...wrong]),
          });
      }
    }
  });

  // Most appearances (attendance)
  const attCount: Record<string, Set<number>> = {};
  Object.entries(allResults).forEach(([key, results]) => {
    const u = key.indexOf("_");
    const yr = parseInt(key.slice(0, u));
    const fmt = key.slice(u + 1);
    if (fmt !== "T1 2-Player" && fmt !== "T1 Multiplayer") return;
    results.forEach((e) => {
      if (e.playerName) {
        if (!attCount[e.playerName]) attCount[e.playerName] = new Set<number>();
        attCount[e.playerName].add(yr);
      }
    });
  });
  const attArr = Object.entries(attCount)
    .map(([n, s]) => ({ name: n, count: s.size }))
    .sort((a, b) => b.count - a.count);
  if (attArr.length >= 4) {
    const top = attArr[0];
    const opts = shuffle(attArr.slice(0, 5).map((x) => x.name)).slice(0, 4);
    if (!opts.includes(top.name)) opts[0] = top.name;
    qs.push({
      q: `Which player has attended the most Nationals?`,
      correct: top.name,
      options: opts,
    });
    qs.push({
      q: `How many Nationals has ${top.name} attended?`,
      correct: String(top.count),
      options: shuffle(
        [
          ...new Set([top.count, top.count - 1, top.count - 2, attArr[1].count]),
        ].map(String)
      ).slice(0, 4),
    });
  }

  // Most podium finishes
  const podiumCount: Record<string, number> = {};
  Object.entries(allResults).forEach(([key, results]) => {
    if (results.length <= FULL_THRESH) return;
    results
      .filter((r) => r.placement && r.placement <= 3)
      .forEach((e) => {
        if (e.playerName) podiumCount[e.playerName] = (podiumCount[e.playerName] || 0) + 1;
      });
  });
  const podArr = Object.entries(podiumCount).sort((a, b) => b[1] - a[1]);
  if (podArr.length >= 4) {
    const top = podArr[0];
    const opts = shuffle(podArr.slice(0, 5).map((x) => x[0])).slice(0, 4);
    if (!opts.includes(top[0])) opts[0] = top[0];
    qs.push({
      q: `Which player has the most podium finishes (top 3) across all Nationals?`,
      correct: top[0],
      options: opts,
    });
    qs.push({
      q: `How many podium finishes does ${top[0]} have across all Nationals?`,
      correct: String(top[1]),
      options: shuffle(
        [...new Set([top[1], top[1] - 1, podArr[1][1], podArr[2][1]])].map(String)
      ).slice(0, 4),
    });
  }

  // Most wins overall (W/L)
  const winCount: Record<string, number> = {};
  Object.values(allMatches).forEach((matches) => {
    matches.forEach((m) => {
      if (m.winner && !m.topCut)
        winCount[m.winner] = (winCount[m.winner] || 0) + 1;
    });
  });
  const winArr = Object.entries(winCount).sort((a, b) => b[1] - a[1]);
  if (winArr.length >= 4) {
    const top = winArr[0];
    const opts = shuffle(winArr.slice(0, 6).map((x) => x[0])).slice(0, 4);
    if (!opts.includes(top[0])) opts[0] = top[0];
    qs.push({
      q: `Which player has the most match wins across all Nationals?`,
      correct: top[0],
      options: opts,
    });
    qs.push({
      q: `How many match wins does ${top[0]} have across all Nationals?`,
      correct: String(top[1]),
      options: shuffle(
        [...new Set([top[1], top[1] - 10, winArr[1][1], winArr[2][1]])].map(String)
      ).slice(0, 4),
    });
  }

  // ── Fantasy draft trivia ──────────────────────────────────────────────────────
  const fdTours = seed.tournaments.filter((t) => t.fantasyDraft);
  fdTours.forEach((t) => {
    const fd = t.fantasyDraft as FantasyDraft & { picks?: FantasyPick[] };
    const sorted = [...fd.teams].sort((a, b) => b.pts - a.pts);
    const winner = sorted[0];
    const gmNames = sorted.map((tm) => tm.gm);
    const wrongGMs = shuffle(gmNames.filter((g) => g !== winner.gm)).slice(0, 3);
    if (wrongGMs.length >= 3) {
      qs.push({
        q: `Who won the ${t.year} Nationals Fantasy Draft?`,
        correct: winner.gm,
        options: shuffle([winner.gm, ...wrongGMs]),
      });
      qs.push({
        q: `What was the winning score in the ${t.year} Nationals Fantasy Draft?`,
        correct: String(winner.pts),
        options: shuffle(
          [
            ...new Set([
              winner.pts,
              sorted[1].pts,
              sorted[2]?.pts || 0,
              Math.round(winner.pts * 0.9),
            ]),
          ].map(String)
        ).slice(0, 4),
      });
    }
    // Top individual performer
    const allPlayers = fd.teams.flatMap((tm) => tm.players);
    const topPlayer = allPlayers.reduce((a, b) => (b.pts > a.pts ? b : a));
    const wrongPlayers = shuffle(
      allPlayers.filter((p) => p.name !== topPlayer.name).map((p) => p.name)
    ).slice(0, 3);
    if (wrongPlayers.length >= 3)
      qs.push({
        q: `Who was the top scoring player in the ${t.year} Nationals Fantasy Draft?`,
        correct: topPlayer.name,
        options: shuffle([topPlayer.name, ...wrongPlayers]),
      });
    // First overall pick
    if (fd.picks && fd.picks.length) {
      const pick1 = fd.picks.find((p) => p.pick === 1);
      if (pick1) {
        const wrongPicks = shuffle(
          fd.picks.filter((p) => p.pick !== 1 && p.player).map((p) => p.player)
        ).slice(0, 3);
        if (wrongPicks.length >= 3)
          qs.push({
            q: `Who was the first overall pick in the ${t.year} Nationals Fantasy Draft?`,
            correct: pick1.player,
            options: shuffle([pick1.player, ...wrongPicks]),
          });
        qs.push({
          q: `Who had the first overall pick in the ${t.year} Nationals Fantasy Draft?`,
          correct: pick1.gm,
          options: shuffle([
            pick1.gm,
            ...shuffle(gmNames.filter((g) => g !== pick1.gm)).slice(0, 3),
          ]),
        });
      }
    }
  });

  return shuffle(qs);
}
