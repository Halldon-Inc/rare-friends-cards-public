// Number audit: compares every figure our pages show against an independent implementation of rarefriends.com's own
// formulas (getRewardOutlook / holderApyPercent / friendWeight, from github.com/spokesz/rarefriends-web-public) on
// upstream data read in the same second. Since their per-wallet state endpoint was retired (2026-09-25) that data is
// assembled here, separately from lib/upstream.ts, from the same public pieces: their snapshot and owned-nfts routes,
// the per-Friend chain reads their bundle makes, and the holder's Activated events. Pages render fresh on every
// request, so the page block and the read block are usually within a few hundred blocks (about 10 blocks per
// second); strings are compared exactly when the gap is under 300 blocks and with a 1% tolerance otherwise. Any
// larger difference is a real bug.
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
const SNAPSHOT = "https://rarefriends.com/api/protocol/snapshot";
const OWNED = "https://rarefriends.com/api/protocol/owned-nfts";
const TOTALS = "https://rarefriends-snapshot.rarefriends-protocol.workers.dev/snapshot.json";
const AM = "0xD4A35e11318E3679168d409184B788bcF9F283Ac", RF = "0x0779369854d3EcdEA927206718FFD7730C67B71f", WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const COL = { Genesis: "0x116EaA62241751E0c98dA43d458600c6C17cD361", Generations: "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D" };
const MC3 = "0xca11bde05977b3631167028862be2a173976ca11";
const ACTIVATION_FROM_BLOCK = 63101026n; // first block where the ActivationManager has code
const units = (v) => Number(v) / 1e18;
let chain;
async function chainClients() {
  if (chain) return chain;
  const { createPublicClient, http, fallback, parseAbi, parseAbiItem, defineChain } = await import("viem");
  const rh = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } }, contracts: { multicall3: { address: MC3 } } });
  // The chain's own RPC 403s a machine that probes it hard; the public ones and their proxy stand in (the proxy cannot render portraits, not needed here).
  const reads = createPublicClient({ chain: rh, transport: fallback(["https://rpc.mainnet.chain.robinhood.com", "https://rpc-robinhood.globalstake.io", "https://robinhood-rpc.publicnode.com", "https://robinhood.rpc.blxrbdn.com", "https://rarefriends.com/api/genesis/rpc"].map((u) => http(u, { retryCount: 0 }))) });
  // Log endpoints, tried in turn per block range. Neither answers the whole history in one query any more (2026-09-26:
  // globalstake's launch-week blocks take 10 to 20 s, the chain RPC caps a query at 2 s), so the audit reads 500k-block
  // ranges with patient timeouts. Deliberately not the site's chunking or hedging: this is the independent reader.
  const logs = [http("https://rpc-robinhood.globalstake.io", { retryCount: 0, timeout: 40_000 }), http("https://rpc.mainnet.chain.robinhood.com", { retryCount: 0, timeout: 10_000 })].map((transport) => createPublicClient({ chain: rh, transport }));
  return (chain = {
    reads, logs,
    am: parseAbi(["function positions(address collection, uint256 tokenId) view returns (uint8 tier, uint256 weight)", "function earned(address asset, address collection, uint256 tokenId) view returns (uint256)"]),
    nft: parseAbi(["function tokenBoundAccount(uint256 tokenId) view returns (address)", "function generation(uint256 tokenId) view returns (uint8)"]),
    erc20: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    mc: parseAbi(["function getEthBalance(address addr) view returns (uint256)"]),
    activated: parseAbiItem("event Activated(address indexed collection, uint256 indexed tokenId, address indexed holder, uint8 tier, uint256 weight, uint256 payment)"),
  });
}
// The retired state response, rebuilt independently of the site's own code. Null when a piece would not answer.
async function readState(addr) {
  const c = await chainClients();
  const json = (u) => fetch(u, { headers: { accept: "application/json" } }).then((r) => { if (!r.ok) throw new Error(`${u.split("?")[0]} answered ${r.status}`); return r.json(); });
  // eth_blockNumber is served by every transport (their proxy refuses eth_getBlockByNumber); the wall clock is the block time here.
  const [snap, owned, bn, totals] = await Promise.all([json(SNAPSHOT), json(`${OWNED}?address=${addr.toLowerCase()}`), c.reads.getBlockNumber({ cacheTime: 0 }), json(TOTALS).catch(() => null)]);
  const nowMs = Date.now();
  const nfts = owned.nfts.map((n) => ({ collection: n.collection, id: BigInt(n.id) }));
  const ok = (x, what) => { if (!x || x.status !== "success") throw new Error(`chain read failed: ${what}`); return x.result; };
  const calls = nfts.flatMap((n) => [
    { address: AM, abi: c.am, functionName: "positions", args: [COL[n.collection], n.id] },
    { address: AM, abi: c.am, functionName: "earned", args: [RF, COL[n.collection], n.id] },
    { address: AM, abi: c.am, functionName: "earned", args: [WETH, COL[n.collection], n.id] },
    { address: COL[n.collection], abi: c.nft, functionName: "tokenBoundAccount", args: [n.id] },
    { address: COL[n.collection], abi: c.nft, functionName: "generation", args: [n.id] },
  ]);
  const r = nfts.length ? await c.reads.multicall({ contracts: calls, blockNumber: bn, batchSize: 8192, allowFailure: true }) : []; // the RPC rejects bigger eth_call payloads
  const pos = nfts.map((n, i) => {
    const [tier, weight] = ok(r[i * 5], `positions ${n.collection} #${n.id}`);
    const generation = n.collection === "Generations" ? Number(ok(r[i * 5 + 4], `generation #${n.id}`)) : 0; // reverts on Genesis
    const hardwired = n.collection === "Genesis" || generation > 0, activated = hardwired && weight > 0n;
    // `earned` reverts for a temporary Friend; their server reports 0 there and no wallet.
    const soft = (x, fallback) => (x?.status === "success" ? x.result : fallback);
    return { n, tier: Number(tier), weight, earnedRf: hardwired ? ok(r[i * 5 + 1], "earned RF") : soft(r[i * 5 + 1], 0n), earnedWeth: hardwired ? ok(r[i * 5 + 2], "earned WETH") : soft(r[i * 5 + 2], 0n), wallet: hardwired ? ok(r[i * 5 + 3], "wallet") : null, generation, hardwired, activated };
  });
  const hw = pos.filter((p) => p.hardwired && p.wallet);
  const bcalls = hw.flatMap((p) => [
    { address: MC3, abi: c.mc, functionName: "getEthBalance", args: [p.wallet] },
    { address: WETH, abi: c.erc20, functionName: "balanceOf", args: [p.wallet] },
    { address: RF, abi: c.erc20, functionName: "balanceOf", args: [p.wallet] },
  ]);
  const b = hw.length ? await c.reads.multicall({ contracts: bcalls, blockNumber: bn, batchSize: 8192, allowFailure: true }) : [];
  const bal = new Map(hw.map((p, i) => [p.wallet, { eth: ok(b[i * 3], "ETH"), weth: ok(b[i * 3 + 1], "WETH"), rf: ok(b[i * 3 + 2], "RF") }]));
  const { ethUsd, rfUsd } = snap.prices;
  const friends = pos.map((p) => {
    const x = bal.get(p.wallet);
    const tokens = x ? [{ symbol: "ETH", balance: units(x.eth), usd: units(x.eth) * ethUsd }, { symbol: "WETH", balance: units(x.weth), usd: units(x.weth) * ethUsd }, { symbol: "$RAREFRIENDS", balance: units(x.rf), usd: units(x.rf) * rfUsd }].filter((t) => t.balance > 0) : [];
    return { id: Number(p.n.id), collection: p.n.collection, generation: p.generation, tier: p.activated ? p.tier : 0, activated: p.activated, hardwired: p.hardwired, earnings: units(p.earnedRf), earningsWeth: units(p.earnedWeth), weight: p.activated ? units(p.weight) : 0, wallet: p.hardwired ? { address: p.wallet, tokens, totalUsd: tokens.reduce((a, t) => a + t.usd, 0) } : null };
  });
  let activationPaid = null;
  try {
    const ranges = [];
    for (let from = ACTIVATION_FROM_BLOCK; from <= bn; from += 500_000n) ranges.push([from, from + 499_999n < bn ? from + 499_999n : bn]);
    // Independent of lib/upstream.ts on purpose. One range at a time (the chain RPC answers 429 to bursts); the chain RPC
    // first, since it says at once when a range is too dense ("log query timed out", its 2 s cap) and the range is then
    // read in halves; a 429 waits and asks again; globalstake is the fallback (it hung past 20 s on 64M to 66M, 2026-09-28).
    const paidIn = async (fromBlock, toBlock) => {
      let last;
      for (const client of [c.logs[1], c.logs[1], c.logs[1], c.logs[0]]) {
        try {
          const events = await client.getLogs({ address: AM, event: c.activated, args: { holder: addr }, fromBlock, toBlock, strict: true });
          return events.reduce((a, e) => a + e.args.payment, 0n);
        } catch (e) {
          last = e;
          const msg = String(e.details ?? e.shortMessage ?? e.message);
          if (/timed out|timeout|too many (results|logs)|range/i.test(msg) && !/too many requests/i.test(msg) && toBlock - fromBlock + 1n > 31_250n) break;
          await sleep(/429|too many requests/i.test(msg) ? 2_000 : 1_000);
        }
      }
      if (toBlock - fromBlock + 1n <= 31_250n) throw last;
      const mid = fromBlock + (toBlock - fromBlock) / 2n;
      return (await paidIn(fromBlock, mid)) + (await paidIn(mid + 1n, toBlock));
    };
    const sums = [];
    for (const [fromBlock, toBlock] of ranges) sums.push(await paidIn(fromBlock, toBlock));
    activationPaid = units(sums.reduce((a, x) => a + x, 0n));
  } catch (e) { console.log(`  (activation history unavailable: ${String(e.shortMessage ?? e.message).slice(0, 80)})`); }
  // Protocol-wide APR: their rewardApyPercent on their published totals (the figure their home page used to print).
  const totalPaid = /^\d+$/.test(totals?.protocolSnapshot?.activationPaid ?? "") ? units(BigInt(totals.protocolSnapshot.activationPaid)) : 0;
  const weeklyUsd = snap.streams.reduce((a, s) => a + (s.end > nowMs ? s.budget : 0) * (s.asset === "RF" ? rfUsd : ethUsd), 0);
  const rewardApy = totalPaid > 0 ? (weeklyUsd / (totalPaid * rfUsd)) * (365 / 7) * 100 : 0;
  return { account: { address: addr, friends, rewardAccounting: "friend", activationPaid, activationPaidUnknown: activationPaid == null }, protocol: { metrics: { ...snap.metrics, rewardApy }, prices: snap.prices, streams: snap.streams }, blockNumber: String(bn) };
}
async function api(addr) {
  // Their routes and the public RPCs fail transiently; keep trying for a while before giving up on a wallet.
  for (let i = 0; i < 4; i++) {
    try { return await readState(addr); } catch (e) { console.log(`  (upstream read failed: ${String(e.shortMessage ?? e.message).slice(0, 100)})`); }
    await sleep(2000);
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
  check("Your APR sub", got["Your APR"]?.sub ?? "(missing)", apy != null ? "current active stream ÷ RF you paid to activate · annualized" : a.activationPaidUnknown ? "reading the activation history…" : `no RF paid to activate · protocol APR ${p.metrics.rewardApy > 0 ? `${num(p.metrics.rewardApy, 0)}%` : "—"}`, true);
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
