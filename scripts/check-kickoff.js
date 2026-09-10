const fs = require("fs");
const {getDoc} = require("./lib");

const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID;

function setOutput(shouldRun) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `should_run=${shouldRun}\n`);
  }
  console.log(`should_run=${shouldRun}`);
}

async function main() {
  const nflState = await (await fetch("https://api.sleeper.app/v1/state/nfl")).json();
  const week = nflState.week || 1;
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`)).json();
  const season = league.season;

  const already = await getDoc(`boardSnapshotPosted/${season}_${week}`);
  if (already) {
    console.log(`Week ${week} board snapshot already posted — nothing to do.`);
    setOutput(false);
    return;
  }

  const espnRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}`,
  );
  if (!espnRes.ok) {
    console.log("ESPN scoreboard fetch failed this run — will retry in 5 minutes.");
    setOutput(false);
    return;
  }
  const espnData = await espnRes.json();
  const kickoffs = (espnData.events || [])
      .map((e) => new Date(e.date).getTime())
      .filter((t) => !isNaN(t));

  if (kickoffs.length === 0) {
    console.log(`No games found for week ${week} yet.`);
    setOutput(false);
    return;
  }

  const firstKickoff = Math.min(...kickoffs);
  const minutesToKickoff = (firstKickoff - Date.now()) / 60000;
  console.log(`First kickoff of week ${week} is in ${minutesToKickoff.toFixed(1)} minutes.`);

  // Fire from 10 minutes before kickoff up to 30 minutes after — the extra
  // slack on the back end absorbs GitHub's scheduling delays so a late run
  // still catches it instead of missing the window entirely.
  const shouldRun = minutesToKickoff <= 10 && minutesToKickoff >= -30;
  setOutput(shouldRun);
}

main().catch((err) => {
  console.error(err);
  setOutput(false);
});
