const {chromium} = require("playwright");
const {getDoc, setDoc, postFileToDiscord} = require("./lib");

const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID;
const SITE_URL = process.env.SITE_URL;

async function main() {
  if (!SITE_URL) throw new Error("SITE_URL is not set in the workflow env.");

  const nflState = await (await fetch("https://api.sleeper.app/v1/state/nfl")).json();
  const week = nflState.week || 1;
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`)).json();
  const season = league.season;

  const postedKey = `boardSnapshotPosted/${season}_${week}`;
  const already = await getDoc(postedKey);
  if (already) {
    console.log("Already posted (likely a race with another run) — skipping.");
    return;
  }

  console.log(`Loading ${SITE_URL} ...`);
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1280, height: 1600}});

  try {
    await page.goto(SITE_URL, {waitUntil: "networkidle", timeout: 60000});
    // Give the page's own Sleeper + Firebase fetches a beat to finish
    // rendering after the network goes idle between calls.
    await page.waitForSelector("#board-grid .ticket, #board-grid .state-msg", {timeout: 30000});
    await page.waitForTimeout(3000);

    const target = await page.$("#board-section");
    if (!target) throw new Error("Could not find #board-section on the page to screenshot.");

    const buffer = await target.screenshot();
    await postFileToDiscord(
        buffer,
        `week-${week}-board.png`,
        `🏈 **Week ${week} board** — kickoff is just minutes away. Here's who's on the clock.`,
    );
    await setDoc(postedKey, {postedAt: new Date().toISOString()});
    console.log("Posted board snapshot to Discord.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
