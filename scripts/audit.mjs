// Number audit: compares every figure our pages show against an independent implementation of rarefriends.com's own
// formulas (getRewardOutlook / holderApyPercent / friendWeight, from github.com/spokesz/rarefriends-web-public) on API data
// read in the same second. Pages render fresh on every request, so the page block and the API block are usually
// within a few hundred blocks (about 10 blocks per second); strings are compared exactly when the gap is under 300
// blocks and with a 1% tolerance otherwise. Any larger difference is a real bug.
//
//   node scripts/audit.mjs https://rare-friends-cards.vercel.app <wallet or ENS> [<wallet or ENS> ...]
//
// Exits 1 on any failed check. Run it after every deploy.
const base = process.argv[2];
const wallets = process.argv.slice(3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => h.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const cells = (html) => {
  const out = {};
  for (const m of html.matchAll(/<span class="lbl">(.*?)<\/span><b>(.*?)<\/b>(?:<small>(.*?)<\/small>)?/gs)) out[strip(m[1])] = { v: strip(m[2]), sub: strip(m[3] || "") };
  return out;
};
const pageBlock = (html) => (html.match(/block (?:<!-- -->)?(\d+)/) || [])[1];
const usd = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
const pct2 = (v) => num(v, 2) + "%";
const sharePct = (v) => (v === 0 ? "0%" : v >= 0.01 ? num(v, 2) + "%" : v.toLocaleString("en-US", { maximumSignificantDigits: 2 }) + "%");
const number = (s) => parseFloat(String(s).replace(/[$,%]/g, ""));
const norm = (s) => (s ?? "").toUpperCase().replace(/^\$/, "");

let bad = 0, checks = 0, skipped = 0;
// Money and percentages accrue every block (a 7-Genesis wallet gains about 0.25 RF a second), so they always get a
// tolerance: 0.1% when the page and API blocks are close, 1% otherwise. Counts, weights, shares and labels are exact.
function check(label, got, exp, close) {
  let ok = got === exp;
  if (!ok && /[$%]|RF/.test(exp) && isFinite(number(got))) {
    const tol = close ? 0.001 : 0.01;
    const gn = String(got).split(" ").map(number).filter(isFinite), en = String(exp).split(" ").map(number).filter(isFinite);
    ok = gn.length === en.length && gn.every((g, i) => Math.abs(g - en[i]) <= Math.max(0.02, tol * Math.abs(en[i])));
  }
  checks++;
  if (!ok) bad++;
  console.log(`  ${ok ? "OK " : "BAD"} ${label.padEnd(34)} ours=${String(got).padEnd(28)} site-formula=${exp}`);
}
async function api(addr) {
  // The API answers 502 ("chain request could not be completed") a few percent of the time, most of the time on a
  // bad night (2026-09-17 02:00 UTC); keep trying for a while before giving up on a wallet.
  for (let i = 0; i < 8; i++) {
    const j = await fetch(`https://rarefriends.com/api/protocol/state?address=${addr.toLowerCase()}`).then((r) => r.json()).catch(() => null);
    if (j?.account) return j;
    await sleep(1500);
  }
  return null;
}

// ENS inputs: the page prints the name everywhere (never the 0x form), so resolve it here the way the site does.
async function resolve(w) {
  if (/^0x[0-9a-fA-F]{40}$/.test(w)) return w;
  const { createPublicClient, http, fallback } = await import("viem");
  const { mainnet } = await import("viem/chains");
  const { normalize } = await import("viem/ens");
  const c = createPublicClient({ chain: mainnet, transport: fallback([http("https://eth.merkle.io"), http("https://ethereum-rpc.publicnode.com")]) });
  return (await c.getEnsAddress({ name: normalize(w) })) ?? null;
}

for (const w of wallets) {
  const html = await (await fetch(`${base}/card/${encodeURIComponent(w)}`)).text();
  const addr = await resolve(w).catch(() => null);
  const state = addr ? await api(addr) : null;
  if (!state?.account) { console.log(`\n== ${w}: API unavailable, skipped`); skipped++; continue; }
  const a = state.account, p = state.protocol, now = Date.now();
  // Under about 10 s of block gap the accruing values move less than 0.1%; beyond that a 1% tolerance is right.
  const pb = pageBlock(html), gap = pb ? Math.abs(Number(state.blockNumber) - Number(pb)) : Infinity, exact = gap < 100;
  console.log(`\n== ${w}  (${a.friends.length} friends, page block ${pb ?? "?"}, api block ${state.blockNumber}, gap ${gap}${exact ? ", exact compare" : ", 1% tolerance"})`);

  const fw = (f) => (f.activated && f.hardwired ? f.weight ?? 0 : 0);
  const t = p.metrics.genesisWeight + p.metrics.generationsWeight, hw = a.friends.reduce((x, f) => x + fw(f), 0), share = Math.min(1, hw / t);
  const px = (s) => (s.asset === "RF" ? p.prices.rfUsd : p.prices.ethUsd), rem = (s) => Math.max(0, s.remaining ?? s.budget - s.dripped);
  let claimRf = a.friends.reduce((x, f) => x + (f.earnings || 0), 0), claimWeth = a.friends.reduce((x, f) => x + (f.earningsWeth || 0), 0);
  if (a.rewardAccounting && a.rewardAccounting !== "friend") { claimRf += a.rewardCredit || 0; claimWeth += a.rewardCreditWeth || 0; }
  const pendingFor = (sh) => p.streams.reduce((x, s) => x + (rem(s) + s.pending) * sh * px(s), 0);
  // APR numerator: the active stream's budget only. Pending fees left it on 2026-09-20 (their commit 0a056d3).
  const weeklyFor = (weight) => p.streams.reduce((x, s) => x + (s.end > now ? s.budget : 0) * (weight / t) * px(s), 0);
  const apy = a.activationPaid > 0 ? (weeklyFor(hw) / (a.activationPaid * p.prices.rfUsd)) * (365 / 7) * 100 : null;

  const got = cells(html);
  const exp = {
    Inactive: String(a.friends.filter((f) => fw(f) <= 0).length),
    Earning: String(a.friends.filter((f) => fw(f) > 0).length),
    Claimable: usd(claimRf * p.prices.rfUsd + claimWeth * p.prices.ethUsd),
    Pending: usd(pendingFor(share)),
    "Your APR": apy != null ? pct2(apy) : "—",
  };
  for (const k of Object.keys(exp)) check(k, got[k]?.v ?? "(missing)", exp[k], exact && !/[$%]/.test(exp[k]) ? true : exact);
  check("Claimable sub", got.Claimable?.sub ?? "(missing)", `${num(claimRf, 2)} RF + ${num(claimWeth, 5)} WETH`, false);
  check("Your APR sub", got["Your APR"]?.sub ?? "(missing)", apy != null ? "current active stream ÷ RF you paid to activate · annualized" : `no RF paid to activate · protocol APR ${num(p.metrics.rewardApy, 0)}%`, true);
  // The page renders its card inline from the same snapshot as the strip (a data URI), so the two cannot disagree.
  check("card embedded inline", /class="card" src="data:image\/png;base64,[A-Za-z0-9+/]{1000,}/.test(html) ? "inline png" : "(missing)", "inline png", true);
  check("download button present", /\[ download png \]/.test(html) ? "present" : "(missing)", "present", true);

  // Friend pages: a representative set, not just friends[0].
  const pick = [a.friends[0], a.friends.find((f) => fw(f) > 0 && f.collection !== "Genesis"), a.friends.find((f) => f.collection !== "Genesis" && !f.hardwired), a.friends.find((f) => fw(f) <= 0), a.friends.find((f) => fw(f) > 0 && f.generation >= 4), a.friends.find((f) => (f.wallet?.tokens ?? []).some((x) => norm(x.symbol) === "RAREFRIENDS" && x.balance > 0))];
  const seen = new Set();
  for (const f of pick) {
    if (!f || seen.has(`${f.collection}-${f.id}`)) continue;
    seen.add(`${f.collection}-${f.id}`);
    const dup = a.friends.some((x) => x !== f && String(x.id) === String(f.id));
    const slug = dup && f.collection !== "Genesis" ? `gen-${f.id}` : String(f.id);
    const fh = await (await fetch(`${base}/card/${encodeURIComponent(w)}/${slug}`)).text();
    const fc = cells(fh), fpb = pageBlock(fh), fexact = fpb ? Math.abs(Number(state.blockNumber) - Number(fpb)) < 100 : false;
    const label = f.collection === "Genesis" ? "Genesis" : f.hardwired ? `Gen-${f.generation}` : "Temp";
    const tag = `${label} #${f.id}`;
    const tokens = f.wallet?.tokens ?? [];
    const rf = tokens.filter((x) => ["RAREFRIENDS", "RF"].includes(norm(x.symbol))).reduce((x, y) => x + (y.balance || 0), 0);
    const weth = tokens.filter((x) => norm(x.symbol) === "WETH").reduce((x, y) => x + (y.balance || 0), 0);
    check(`${tag} to claim`, fc["to claim"]?.v ?? "(missing)", usd((f.earnings || 0) * p.prices.rfUsd + (f.earningsWeth || 0) * p.prices.ethUsd), fexact);
    check(`${tag} pending`, fc.pending?.v ?? "(missing)", usd(pendingFor(Math.min(1, fw(f) / t))), fexact);
    check(`${tag} reward weight`, fc["reward weight"]?.v ?? "(missing)", num(fw(f), 6), true);
    check(`${tag} share`, fc["reward weight"]?.sub ?? "(missing)", `${sharePct((Math.min(1, fw(f) / t)) * 100)} of active weight`, true);
    if (f.wallet) {
      check(`${tag} NFT wallet`, fc["NFT wallet"]?.v ?? "(missing)", usd(f.wallet.totalUsd || 0), fexact);
      check(`${tag} NFT wallet sub`, fc["NFT wallet"]?.sub ?? "(missing)", `${num(rf, 3)} RF · ${num(weth, 6)} WETH`, true);
    } else {
      check(`${tag} NFT wallet`, fc["NFT wallet"]?.v ?? "(missing)", "none yet", true);
    }
    // The row for this Friend on the portfolio page.
    const status = fw(f) > 0 ? "earning" : f.collection !== "Genesis" && !f.hardwired ? "temporary · balance-dependent" : "not activated";
    check(`${tag} list row`, strip(html).includes(`${status} · weight ${num(fw(f), 6)}`) ? "present" : "(missing)", "present", true);
    await sleep(800);
  }
  for (const path of [`/card/${encodeURIComponent(w)}/og`, `/card/${encodeURIComponent(w)}/${[...seen][0]?.split("-").slice(1).join("-") ?? ""}/og`]) {
    const r = await fetch(`${base}${path}`);
    const b = await r.arrayBuffer();
    const ok = r.status === 200 && r.headers.get("content-type") === "image/png" && b.byteLength > 20000 && r.headers.get("x-card-fonts") === "local";
    if (!ok) bad++;
    console.log(`  ${ok ? "OK " : "BAD"} PNG ${path.replace(encodeURIComponent(w), "…")} ${r.status} ${b.byteLength}b fonts=${r.headers.get("x-card-fonts")}`);
  }
  await sleep(1500);
}
// A run that graded nothing is not a pass: the upstream was down, or the page shape changed under the parser.
if (checks === 0) { console.log(`\nRESULT: NO DATA (0 checks, ${skipped} wallet(s) skipped)`); process.exit(1); }
console.log(`\nRESULT: ${bad === 0 && skipped === 0 ? `ALL ${checks} CHECKS PASS` : `${bad} CHECK(S) FAILED, ${skipped} wallet(s) skipped, ${checks} checks`}`);
process.exit(bad || skipped ? 1 : 0);
