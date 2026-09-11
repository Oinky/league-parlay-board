const {getDoc, setDoc, postToDiscord} = require("./lib");

const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID;
// How many hours before the first kickoff to send the reminder.
const REMINDER_HOURS_BEFORE = 3;

async function main() {
  const nflState = await (await fetch("https://api.sleeper.app/v1/state/nfl")).json();
  const week = nflState.week || 1;
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`)).json();
  const season = league.season;

  const remindedKey = `lockReminderPosted/${season}_${week}`;
  const alreadyReminded = await getDoc(remindedKey);
  if (alreadyReminded) {
    console.log(`Week ${week} reminder already posted — nothing to do.`);
    return;
  }

  const espnRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}`,
  );
  if (!espnRes.ok) {
    console.log("ESPN scoreboard fetch failed this run — will retry in 5 minutes.");
    return;
  }
  const espnData = await espnRes.json();
  const kickoffs = (espnData.events || [])
      .map((e) => new Date(e.date).getTime())
      .filter((t) => !isNaN(t));
  if (kickoffs.length === 0) {
    console.log(`No games found for week ${week} yet.`);
    return;
  }

  const firstKickoff = Math.min(...kickoffs);
  const hoursToKickoff = (firstKickoff - Date.now()) / 3600000;
  console.log(`First kickoff of week ${week} is in ${hoursToKickoff.toFixed(2)} hours.`);

  // Fire once we're at or under the reminder threshold, with a little
  // slack past kickoff itself in case a run gets delayed and we're already
  // past the ideal window — still better to remind late than never.
  const shouldRemind = hoursToKickoff <= REMINDER_HOURS_BEFORE && hoursToKickoff >= -0.5;
  if (!shouldRemind) {
    console.log("Not within the reminder window yet.");
    return;
  }

  const users = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`)).json();
  const nameByUser = {};
  users.forEach((u) => {
    nameByUser[u.user_id] = (u.metadata && u.metadata.team_name) ? u.metadata.team_name : u.display_name;
  });

  const parlays = await getDoc(`parlays/${season}_${week}`) || {};
  const submittedUserIds = new Set(Object.keys(parlays));
  const missing = Object.keys(nameByUser).filter((uid) => !submittedUserIds.has(uid));

  let msg;
  if (missing.length === 0) {
    msg = `✅ **Week ${week} picks are all in!** Everyone's got a parlay locked in — kickoff is close.`;
  } else {
    const names = missing.map((uid) => `• ${nameByUser[uid]}`).join("\n");
    msg = [
      `⏰ **Picks close soon for week ${week}!** Kickoff is in about ${Math.max(hoursToKickoff, 0).toFixed(1)} hours.`,
      `Still missing a parlay:`,
      names,
    ].join("\n");
  }

  await postToDiscord(msg);
  await setDoc(remindedKey, {postedAt: new Date().toISOString()});
  console.log("Posted lock reminder to Discord.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
