const {getDoc, setDoc, postToDiscord} = require("./lib");

const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID;
const POINTS_TABLE = {2: 1, 3: 3, 4: 6, 5: 10, 6: 15};

async function main() {
  const nflState = await (await fetch("https://api.sleeper.app/v1/state/nfl")).json();
  const currentWeek = nflState.week || 1;
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`)).json();
  const season = league.season;

  const cursorDoc = await getDoc("botState/cursor");
  const lastNotifiedAt = (cursorDoc && cursorDoc.lastNotifiedAt) || "1970-01-01T00:00:00.000Z";
  let maxSeen = lastNotifiedAt;

  for (let week = 1; week <= currentWeek; week++) {
    const parlays = await getDoc(`parlays/${season}_${week}`);
    if (!parlays) continue;

    for (const [userId, pick] of Object.entries(parlays)) {
      if (!pick || !pick.submittedAt || !Array.isArray(pick.legs)) continue;
      if (pick.submittedAt <= lastNotifiedAt) continue; // already notified last run

      const legsList = pick.legs.map((l) => `• **${l.teamName}** (over ${l.opponentName})`).join("\n");
      const potential = pick.potentialPoints ?? POINTS_TABLE[pick.legs.length] ?? "?";
      const verb = pick.editedByAdmin ? "updated (admin)" : "placed";
      const msg = [
        `🎟️ **${pick.teamName || "Someone"}** ${verb} a parlay — Week ${pick.week ?? week}`,
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
