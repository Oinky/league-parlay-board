const {getDoc, setDoc, postToDiscord} = require("./lib");

const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID;
const POINTS_TABLE = {2: 1, 3: 3, 4: 6, 5: 10, 6: 15};

async function main() {
  const nflState = await (await fetch("https://api.sleeper.app/v1/state/nfl")).json();
  const currentWeek = nflState.week || 1;
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`)).json();
  const season = league.season;

  // Fetch league membership once up front so we can fill in any names
  // missing from the stored pick (e.g. parlays placed by an older
  // version of the site, before team/opponent names were saved).
  const [users, rosters] = await Promise.all([
    (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`)).json(),
    (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`)).json(),
  ]);
  const nameByUser = {};
  users.forEach((u) => {
    nameByUser[u.user_id] = (u.metadata && u.metadata.team_name) ? u.metadata.team_name : u.display_name;
  });
  const nameByRoster = {};
  rosters.forEach((r) => {
    nameByRoster[r.roster_id] = nameByUser[r.owner_id] || `Roster ${r.roster_id}`;
  });

  const matchupNameCache = {}; // week -> {matchupId -> {teamA:{rosterId,name}, teamB:{...}}}
  async function matchupNamesForWeek(week) {
    if (matchupNameCache[week]) return matchupNameCache[week];
    const raw = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${week}`)).json();
    const byId = new Map();
    raw.forEach((e) => {
      if (e.matchup_id === null || e.matchup_id === undefined) return;
      if (!byId.has(e.matchup_id)) byId.set(e.matchup_id, []);
      byId.get(e.matchup_id).push(e);
    });
    const out = {};
    byId.forEach((entries, matchupId) => {
      if (entries.length !== 2) return;
      const [a, b] = entries;
      out[matchupId] = {
        teamA: {rosterId: a.roster_id, name: nameByRoster[a.roster_id] || "Unknown team"},
        teamB: {rosterId: b.roster_id, name: nameByRoster[b.roster_id] || "Unknown team"},
      };
    });
    matchupNameCache[week] = out;
    return out;
  }

  const cursorDoc = await getDoc("botState/cursor");
  const lastNotifiedAt = (cursorDoc && cursorDoc.lastNotifiedAt) || "1970-01-01T00:00:00.000Z";
  let maxSeen = lastNotifiedAt;

  for (let week = 1; week <= currentWeek; week++) {
    const parlays = await getDoc(`parlays/${season}_${week}`);
    if (!parlays) continue;

    for (const [userId, pick] of Object.entries(parlays)) {
      if (!pick || !pick.submittedAt || !Array.isArray(pick.legs)) continue;
      if (pick.submittedAt <= lastNotifiedAt) continue; // already notified last run

      const teamName = pick.teamName || nameByUser[userId] || "Someone";

      // Fill in any missing leg names from Sleeper's live matchups so old
      // or incomplete pick data still renders a readable message.
      const needsLookup = pick.legs.some((l) => !l.teamName || !l.opponentName);
      const namesForWeek = needsLookup ? await matchupNamesForWeek(pick.week ?? week) : null;

      const legsList = pick.legs.map((l) => {
        let tn = l.teamName;
        let on = l.opponentName;
        if ((!tn || !on) && namesForWeek) {
          const m = namesForWeek[l.matchupId];
          if (m) {
            const isA = m.teamA.rosterId === l.rosterId;
            tn = tn || (isA ? m.teamA.name : m.teamB.name);
            on = on || (isA ? m.teamB.name : m.teamA.name);
          }
        }
        return `• **${tn || "Unknown team"}** (over ${on || "unknown opponent"})`;
      }).join("\n");

      const potential = pick.potentialPoints ?? POINTS_TABLE[pick.legs.length] ?? "?";
      const verb = pick.editedByAdmin ? "updated (admin)" : "placed";
      const msg = [
        `🎟️ **${teamName}** ${verb} a parlay — Week ${pick.week ?? week}`,
        legsList,
        `Potential: **${potential} pts** (${pick.legs.length}-leg, all-or-nothing)`,
      ].join("\n");

      await postToDiscord(msg);
      if (pick.submittedAt > maxSeen) maxSeen = pick.submittedAt;
    }
  }

  if (maxSeen !== lastNotifiedAt) {
    await setDoc("botState/cursor", {lastNotifiedAt: maxSeen});
  } else {
    console.log("No new submissions this run.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
