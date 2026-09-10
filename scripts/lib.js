// Minimal Firestore REST client + Discord poster, no dependencies needed.
// Reads/writes rely on your Firestore rules allowing open access to these
// collections (see the rules snippet in the setup instructions).

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fromValue(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromValue(v);
  return out;
}

function toValue(v) {
  if (v === null || v === undefined) return {nullValue: null};
  if (typeof v === "string") return {stringValue: v};
  if (typeof v === "number") {
    return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  }
  if (typeof v === "boolean") return {booleanValue: v};
  if (Array.isArray(v)) return {arrayValue: {values: v.map(toValue)}};
  if (typeof v === "object") return {mapValue: {fields: toFields(v)}};
  return {stringValue: String(v)};
}

function toFields(obj) {
  const out = {};
  for (const [k, val] of Object.entries(obj)) out[k] = toValue(val);
  return out;
}

async function getDoc(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return fromFields(json.fields || {});
}

async function setDoc(path, obj) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "PATCH",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({fields: toFields(obj)}),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${path} failed: ${res.status} ${await res.text()}`);
}

async function postToDiscord(content) {
  if (!WEBHOOK_URL) {
    console.error("DISCORD_WEBHOOK_URL is not set");
    return;
  }
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({content}),
  });
  if (!res.ok) console.error("Discord post failed", res.status, await res.text());
}

async function postFileToDiscord(buffer, filename, content) {
  if (!WEBHOOK_URL) {
    console.error("DISCORD_WEBHOOK_URL is not set");
    return;
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify({content: content || ""}));
  form.append("file", new Blob([buffer], {type: "image/png"}), filename);
  const res = await fetch(WEBHOOK_URL, {method: "POST", body: form});
  if (!res.ok) console.error("Discord file post failed", res.status, await res.text());
}

module.exports = {getDoc, setDoc, postToDiscord, postFileToDiscord};
