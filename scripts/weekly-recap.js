const {getDoc, setDoc, postToDiscord} = require("./lib");

const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID;
const POINTS_TABLE = {2: 1, 3: 3, 4: 6, 5: 10, 6: 15};

async function main() {
  const nflState = await (await fetch("https://api.sleeper.app/v1/state/nfl")).json();
  const justFinishedWeek = (nflState.week || 1) - 1;
  if (justFinishedWeek < 1) {
    console.log("No completed week yet.");
    return;
  }

  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`)).json();
  const season = league.season;

  const posted = await getDoc(`summaryPosted/${season}_${justFinishedWeek}`);
  if (posted) {
    console.log(`Week ${justFinishedWeek} recap already posted.`);
    return;
  }

  const [users, rawMatchups, parlays] = await Promise.all([
    (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`)).json(),
    (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${justFinishedWeek}`)).json(),
    getDoc(`parlays/${season}_${justFinishedWeek}`),
  ]);

  const nameByUser = {};
  users.forEach((u) => {
    nameByUser[u.user_id] = (u.metadata && u.metadata.team_name) ? u.metadata.team_name : u.display_name;
  });

  const byMatchup = new Map();
  rawMatchups.forEach((e) => {
    if (e.matchup_id === null || e.matchup_id === undefined) return;
    if (!byMatchup.has(e.matchup_id)) byMatchup.set(e.matchup_id, []);
    byMatchup.get(e.matchup_id).push(e);
  });

  function winnerRosterId(matchupId) {
    const entries = byMatchup.get(matchupId);
    if (!entries || entries.length !== 2) return null;
    const [a, b] = entries;
    if (a.points === b.points) return null;
    return a.points > b.points ? a.roster_id : b.roster_id;
  }

  const picks = parlays || {};
  const results = Object.entries(picks).map(([userId, pick]) => {
    let hit = Array.isArray(pick.legs) && pick.legs.length >= 2;
    for (const leg of (pick.legs || [])) {
      if (winnerRosterId(leg.matchupId) !== leg.rosterId) {
        hit = false;
        break;
      }
    }
    const pts = hit ? (POINTS_TABLE[pick.legs.length] || 0) : 0;
    return {
      teamName: pick.teamName || nameByUser[userId] || "Unknown team",
      hit,
      pts,
      legCount: pick.legs ? pick.legs.length : 0,
    };
  }).sort((a, b) => b.pts - a.pts);

  if (results.length === 0) {
    await postToDiscord(`📋 **Week ${justFinishedWeek} recap** — nobody placed a parlay this week.`);
  } else {
    const lines = results.map((r) =>
      `${r.hit ? "✅" : "❌"} **${r.teamName}** — ${r.legCount}-leg — ${r.pts} pt${r.pts === 1 ? "" : "s"}`,
    );
    await postToDiscord([`📋 **Week ${justFinishedWeek} recap**`, ...lines].join("\n"));
  }

  await setDoc(`summaryPosted/${season}_${justFinishedWeek}`, {postedAt: new Date().toISOString()});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
