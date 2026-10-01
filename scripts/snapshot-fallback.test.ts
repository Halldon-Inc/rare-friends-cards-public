// Run: npx tsx scripts/snapshot-fallback.test.ts
// A snapshot answered with a null price must fall back to the last complete one for up to 10 minutes, then refuse.
import assert from "node:assert/strict";
import { readSnapshot } from "../lib/upstream";

const good = { prices: { ethUsd: 2688.96, rfUsd: 0.0011 }, metrics: { genesisWeight: 982e6, generationsWeight: 8.1e7 }, streams: [{ asset: "RF", end: 1, budget: 2, pending: 3, remaining: 4 }] };
const bad = { ...good, prices: { ethUsd: 2688.96, rfUsd: null } };
let body: unknown = good;
let status = 200;
globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;

async function main() {
  assert.equal((await readSnapshot(1000)).prices.rfUsd, 0.0011, "a complete snapshot is used as is");

  body = bad;
  assert.equal((await readSnapshot(1000)).prices.rfUsd, 0.0011, "a null price falls back to the held snapshot");

  status = 502;
  assert.equal((await readSnapshot(1000)).prices.rfUsd, 0.0011, "a 502 within the grace window falls back too");

  shift = 11 * 60_000;
  status = 200;
  await assert.rejects(readSnapshot(1000), /prices or weights missing \(rfUsd=null\)/, "past 10 minutes the held copy is refused and the error names the field");

  body = { ...good, prices: { ethUsd: 3000, rfUsd: 0.002 } };
  assert.equal((await readSnapshot(1000)).prices.rfUsd, 0.002, "recovery uses the live answer again");
  console.log("snapshot fallback: 5/5 pass");
}
main().catch((e) => { console.error(e); process.exit(1); });
