import { createPublicClient, defineChain, encodeEventTopics, fallback, getAddress, http, parseAbi, parseAbiItem, parseEventLogs, toHex, type Address, type ContractFunctionParameters, type Log } from "viem";
import { unstable_cache } from "next/cache";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * rarefriends.com retired `/api/protocol/state` and `/api/protocol/config` on 2026-09-25. Both answer 404 with the
 * site's HTML not-found page (`X-Matched-Path: /404`), and no chunk of their live bundle names either route any more.
 * Their portfolio page now assembles the same figures itself from public pieces, and so do we:
 *
 *   1. `GET /api/protocol/snapshot` (CDN-cached 60 s): prices, the two protocol weights, the two reward streams.
 *   2. `GET /api/protocol/owned-nfts?address=<wallet>`: which Genesis and Generations tokens the wallet holds.
 *   3. Robinhood Chain reads, the calls their bundle makes per Friend: `positions`, `earned` (RF and WETH), the
 *      Friend's token-bound wallet and its balances, `generation`, and `tokenURI` for the on-chain portrait.
 *
 * Two figures their new client does not source at all. The RF a holder paid to activate (the APR denominator) is
 * rebuilt the way their previous server did it (`readHolderActivationPaid` in their public source: one
 * holder-filtered `Activated` log query on the ActivationManager). The protocol-wide APR uses their published
 * protocol totals (`activationPaid` from their snapshot worker) in their own `rewardApyPercent`.
 *
 * The result has the shape the retired endpoint had, so `lib/rarefriends.ts` (guards, cache, every formula) is
 * unchanged. Addresses and ABI fragments are copied from their live bundle (portfolio chunk, module 65062) and were
 * verified on-chain on 2026-09-25: `totalWeight()` equals the snapshot's genesis + generations weight, and
 * `positions(Genesis, 354)` reads 2,000,000 weight.
 */

export const SITE = "https://rarefriends.com";
export const SNAPSHOT_API = `${SITE}/api/protocol/snapshot`;
export const OWNED_API = `${SITE}/api/protocol/owned-nfts`;
export const ARTWORK_API = `${SITE}/api/protocol/nft-image`;
/** Their protocol totals publication (public, CORS *, 60 s): the source their server used for history-derived totals. */
export const TOTALS_API = "https://rarefriends-snapshot.rarefriends-protocol.workers.dev/snapshot.json";
/**
 * The chain's own RPC. It answers `eth_call` well, but its log index times out on holder queries (2 s cap, then
 * 429s), and it answered 403 to everything for a while after a burst of probing from one machine (2026-09-25), so
 * every read has public fallbacks.
 */
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
/** rarefriends.com's read-only JSON-RPC proxy (what their browser code uses). Cheap `eth_call`s only: it refuses `eth_getLogs` and reverts the heavy `tokenURI` render. */
export const RPC_PROXY = `${SITE}/api/genesis/rpc`;
/** Public RPCs (chainlist, chain 4663) that answered pinned-block aggregates and `tokenURI` on 2026-09-25. dRPC keeps no state and is left out. */
const PUBLIC_RPCS = ["https://rpc-robinhood.globalstake.io", "https://robinhood-rpc.publicnode.com", "https://robinhood.rpc.blxrbdn.com"];
/**
 * Log queries, one block-range chunk at a time: globalstake first, the chain RPC as the hedge (the other public RPCs
 * refuse `eth_getLogs`: publicnode wants a paid token for the range, blxrbdn answers 403). Measured 2026-09-26:
 * globalstake answers every chunk since block 64.0M in about 100 ms but its launch-week blocks (63.1M to 64.0M) went
 * cold, 9 to 20 s for the holder filter; the chain RPC answered that range in 550 ms but hits its 2 s cap (then 429s)
 * on the denser range after it. So each chunk moves to the next endpoint when the current one has been silent for
 * LOG_HEDGE_MS or has failed, and the first answer wins.
 */
const LOG_RPCS = ["https://rpc-robinhood.globalstake.io", RPC_URL];
const UA = "rare-friends-cards/1.0 (+https://rare-friends-cards.vercel.app)";

export const CHAIN_ID = 4663;
export const CONTRACTS = {
  ActivationManager: "0xD4A35e11318E3679168d409184B788bcF9F283Ac",
  RF: "0x0779369854d3EcdEA927206718FFD7730C67B71f",
  WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  Genesis: "0x116EaA62241751E0c98dA43d458600c6C17cD361",
  Generations: "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D",
  Multicall3: "0xca11bde05977b3631167028862be2a173976ca11",
} as const satisfies Record<string, Address>;
/**
 * First block where the ActivationManager has code (bisected through their RPC proxy on 2026-09-25; the block is
 * from 2026-09-14 20:45 UTC). Only a lower bound for the log query: any block at or below the true deployment is
 * correct, a later one would silently drop payments.
 */
export const ACTIVATION_FROM_BLOCK = 63_101_026n;

const WEEK_MS = 7 * 24 * 3600 * 1000;
/** Most portraits we will attach per wallet, in display order (earning first), and the most bytes of them. */
const ART_MAX = 40;
const ART_BYTES = 1_200_000;
/** A portrait larger than this is refused by `safeImage` anyway. */
const IMG_MAX = 64 * 1024;
const ART_CONCURRENCY = 6;
const OWNED_MAX = 1500;
const PAID_FRESH_MS = 5 * 60_000;
const PAID_STALE_MS = 60 * 60_000;
/** One endpoint's wait on a contract read before the fallback moves on. It was 8 s: one stalled endpoint could spend the whole card's budget. */
const READ_TIMEOUT_MS = 4_000;
/** The Activated history is read in chunks of this many blocks, aligned to ACTIVATION_FROM_BLOCK (about 28 hours of chain). */
const LOG_CHUNK = 1_000_000n;
/** A chunk ending at least this far below the head is sealed: its sum can no longer change, so it is cached (a day, shared). */
const LOG_SEAL_MARGIN = 20_000n;
const LOG_HEDGE_MS = 1_200;
/** One endpoint's attempt at one chunk. Longer than the card waits on purpose: a slow read that lands later still fills the cache. */
const LOG_ATTEMPT_MS = 15_000;
/**
 * Smallest range a chunk is split to when an endpoint reports it too dense to answer. Measured 2026-09-28: globalstake
 * hung past 20 s on blocks 64M to 66M and the chain RPC hit its 2 s cap ("log query timed out") on the whole 1M chunk
 * and on 250k slices of 64.85M to 65.35M, but answered every 62.5k slice there in under a second.
 */
const LOG_MIN_SPLIT = 31_250n;
/**
 * A range an endpoint calls too dense is read in this many parts, chain RPC first. Measured 2026-09-29 on 64.1M to
 * 65.1M: the chain RPC answers each 62.5k slice in about 75 ms but times out at 1M, 500k and 250k, and globalstake
 * takes 2 to 11 s per 125k slice there. Halving paid a 2 s timeout per level and outran a cold card's budget.
 */
const LOG_DENSE_PARTS = 16n;
/** Ranges already found too dense in this process: read in parts straight away instead of timing out first. */
const denseRanges = new Set<string>();
/** An endpoint's answer that the range holds too many logs to scan in time: the range is split, not retried. */
const DENSE_RANGE = /log query timed out|query timeout|query returned more than|too many (results|logs)|block range too large|range is too large/i;
/** The chain RPC answers 429 to bursts (a cold card reads a dozen chunks at once): back off and ask the same endpoint again, at most this many times. */
const RATE_LIMITED = /429|too many requests/i;
const LOG_429_RETRIES = 2;
const LOG_429_BACKOFF_MS = 600;
/** Most the card waits for portraits: those that arrived are attached, the rest render the placeholder. */
const ART_BUDGET_MS = 2_000;

const AM_ABI = parseAbi([
  "function positions(address collection, uint256 tokenId) view returns (uint8 tier, uint256 weight)",
  "function earned(address asset, address collection, uint256 tokenId) view returns (uint256)",
]);
const ACTIVATED = parseAbiItem("event Activated(address indexed collection, uint256 indexed tokenId, address indexed holder, uint8 tier, uint256 weight, uint256 payment)");
const NFT_ABI = parseAbi([
  "function tokenBoundAccount(uint256 tokenId) view returns (address)",
  "function generation(uint256 tokenId) view returns (uint8)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const MULTICALL_ABI = parseAbi(["function getEthBalance(address addr) view returns (uint256)"]);

// ===== diagnostics =====
// Every upstream step reports here. Failures always go to the function log as ONE JSON line tagged "rf-state" (host
// only, never a full RPC URL: ROBINHOOD_RPC_URL may carry a key); successes are kept only in the per-call trace that
// /api/diag/state returns. The trace rides an AsyncLocalStorage so deep helpers need no extra parameters.

export type TraceEvent = { stage: string; at: number; ms: number; ok: boolean; host?: string; method?: string; status?: number; body?: string; error?: string; note?: string };
export type Trace = { wallet: string; started: number; events: TraceEvent[] };
const traceStore = new AsyncLocalStorage<Trace>();
const TRACE_MAX = 400;
export const newTrace = (wallet: string): Trace => ({ wallet, started: Date.now(), events: [] });
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
};
const snippet = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 120);
export function errText(e: unknown) {
  const x = e as { name?: string; shortMessage?: string; message?: string } | undefined;
  return `${x?.name ?? "Error"}: ${String(x?.shortMessage ?? x?.message ?? e).split("\n")[0].slice(0, 200)}`;
}
function note(e: Omit<TraceEvent, "at">) {
  const t = traceStore.getStore();
  const ev: TraceEvent = { ...e, at: t ? Date.now() - t.started : 0 };
  if (t && t.events.length < TRACE_MAX) t.events.push(ev);
  if (!ev.ok) console.warn(JSON.stringify({ tag: "rf-state", wallet: t?.wallet, ...ev }));
}
/** Times one stage; a throw is recorded (and logged) and rethrown unchanged. */
async function step<T>(stage: string, work: () => Promise<T>, describe?: (v: T) => string): Promise<T> {
  const t0 = Date.now();
  try {
    const v = await work();
    note({ stage, ms: Date.now() - t0, ok: true, note: describe?.(v) });
    return v;
  } catch (e) {
    note({ stage, ms: Date.now() - t0, ok: false, error: errText(e) });
    throw e;
  }
}
/** viem's fetch for one RPC endpoint: records every attempt (method, request bytes, status, ms) and any HTTP or JSON-RPC error body. */
function tracedFetch(url: string): typeof fetch {
  const host = hostOf(url);
  return async (input, init) => {
    const t0 = Date.now();
    const raw = typeof init?.body === "string" ? init.body : "";
    let method = "?";
    try {
      const b = JSON.parse(raw);
      method = Array.isArray(b) ? `batch${b.length}:${b[0]?.method}` : String(b?.method);
    } catch {
      // not JSON: leave "?"
    }
    method = `${method} req=${raw.length}B`;
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (e) {
      note({ stage: "rpc", host, method, ms: Date.now() - t0, ok: false, error: errText(e) });
      throw e;
    }
    const text = await res
      .clone()
      .text()
      .catch(() => "");
    const rpcError = /"error"\s*:/.test(text.slice(0, 400));
    note({ stage: "rpc", host, method, status: res.status, ms: Date.now() - t0, ok: res.ok && !rpcError && text.length > 0, body: res.ok && !rpcError ? undefined : snippet(text) });
    return res;
  };
}

const robinhood = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: CONTRACTS.Multicall3 } },
});

const envRpc = () => process.env.ROBINHOOD_RPC_URL?.trim();
const transport = (urls: string[], timeout: number) =>
  fallback(
    [envRpc(), ...urls].filter((u): u is string => !!u).map((u) => http(u, { timeout, retryCount: 0, fetchFn: tracedFetch(u) })),
    { retryCount: 0 }
  );
/** Contract reads: the chain RPC, then the public ones, then their proxy (last: it cannot render a portrait). */
const reads = createPublicClient({ chain: robinhood, transport: transport([RPC_URL, ...PUBLIC_RPCS, RPC_PROXY], READ_TIMEOUT_MS), batch: { multicall: false } });

export class UpstreamError extends Error {}
const timeoutError = (message: string) => Object.assign(new Error(message), { name: "TimeoutError" });
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(`upstream read exceeded ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Collection = "Genesis" | "Generations";
type Owned = { collection: Collection; id: bigint };
type Stream = { asset: "RF" | "WETH"; end: number; budget: number; pending: number; remaining: number };
type Snapshot = { prices: { ethUsd: number; rfUsd: number }; metrics: { genesisWeight: number; generationsWeight: number }; streams: Stream[] };

const units = (wei: bigint) => Number(wei) / 1e18;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);

async function readJson(stage: string, url: string, timeoutMs: number): Promise<unknown> {
  const host = hostOf(url);
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": UA, accept: "application/json" } });
  } catch (e) {
    note({ stage, host, ms: Date.now() - t0, ok: false, error: errText(e) });
    throw e;
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!res.ok || !type.includes("json")) {
    const body = await res.text().catch(() => "");
    note({ stage, host, status: res.status, ms: Date.now() - t0, ok: false, body: `[${type || "no content-type"}] ${snippet(body)}` });
    throw new UpstreamError(`${url.split("?")[0]} answered ${res.status}`);
  }
  try {
    const j = await res.json();
    note({ stage, host, status: res.status, ms: Date.now() - t0, ok: true });
    return j;
  } catch (e) {
    note({ stage, host, status: res.status, ms: Date.now() - t0, ok: false, error: errText(e) });
    throw e;
  }
}

/** `/api/protocol/snapshot`: `{ prices{ethUsd, rfUsd}, metrics{genesisWeight, generationsWeight}, streams[{asset, end, budget, pending, remaining}] }`. */
async function readSnapshot(timeoutMs: number): Promise<Snapshot> {
  const j = await readJson("snapshot", SNAPSHOT_API, timeoutMs);
  if (!isObj(j) || !isObj(j.prices) || !isObj(j.metrics) || !Array.isArray(j.streams)) throw new UpstreamError("snapshot: unexpected shape");
  const { ethUsd, rfUsd } = j.prices;
  const { genesisWeight, generationsWeight } = j.metrics;
  if (!finite(ethUsd) || !finite(rfUsd) || !finite(genesisWeight) || !finite(generationsWeight)) throw new UpstreamError("snapshot: prices or weights missing");
  const streams = j.streams.map((s: unknown): Stream => {
    if (!isObj(s) || (s.asset !== "RF" && s.asset !== "WETH") || !finite(s.end) || !finite(s.budget) || !finite(s.pending) || !finite(s.remaining)) throw new UpstreamError("snapshot: unexpected stream");
    return { asset: s.asset, end: s.end, budget: s.budget, pending: s.pending, remaining: s.remaining };
  });
  return { prices: { ethUsd, rfUsd }, metrics: { genesisWeight, generationsWeight }, streams };
}

/** `/api/protocol/owned-nfts?address=`: `{ nfts: [{ collection: "Genesis" | "Generations", id: "354" }] }`, validated the way their client does. */
async function readOwned(address: Address, timeoutMs: number): Promise<Owned[]> {
  const j = await readJson("owned-nfts", `${OWNED_API}?address=${address}`, timeoutMs);
  if (!isObj(j) || !Array.isArray(j.nfts) || j.nfts.length > OWNED_MAX) throw new UpstreamError("owned-nfts: unexpected shape");
  return j.nfts.map((n: unknown): Owned => {
    if (!isObj(n) || (n.collection !== "Genesis" && n.collection !== "Generations") || typeof n.id !== "string" || !/^[1-9][0-9]{0,77}$/.test(n.id)) throw new UpstreamError("owned-nfts: unexpected token");
    return { collection: n.collection, id: BigInt(n.id) };
  });
}

/** Protocol-wide RF paid to activate, from their snapshot publication. Soft: the protocol APR is small print, never a headline. */
async function readTotalsPaid(timeoutMs: number): Promise<bigint | null> {
  try {
    const j = await readJson("totals", TOTALS_API, timeoutMs);
    if (!isObj(j) || j.chainId !== CHAIN_ID || j.stale === true || !isObj(j.protocolSnapshot)) return null;
    const paid = j.protocolSnapshot.activationPaid;
    return typeof paid === "string" && /^(0|[1-9][0-9]{0,77})$/.test(paid) ? BigInt(paid) : null;
  } catch {
    return null;
  }
}

type Call = ContractFunctionParameters;
type Result = { status: "success" | "failure"; result?: unknown; error?: unknown };
async function multicall(calls: Call[], blockNumber: bigint): Promise<Result[]> {
  if (!calls.length) return [];
  // Calldata per aggregate. 8 KB answered a 425-Friend wallet (2,125 calls) in 350 ms; 16 KB and up made the chain
  // RPC reject the whole `eth_call` ("Invalid parameters"), which viem reports as every call failing. Keep it small.
  return (await reads.multicall({ contracts: calls, blockNumber, batchSize: 8_192, allowFailure: true })) as Result[];
}
function must<T>(r: Result | undefined, what: string): T {
  if (!r || r.status !== "success") {
    const detail = String((r?.error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ?? (r?.error as Error | undefined)?.message ?? "").split("\n")[0].slice(0, 160);
    throw new UpstreamError(`chain read failed: ${what}${detail ? ` (${detail})` : ""}`);
  }
  return r.result as T;
}

type Position = { owned: Owned; tier: number; weight: bigint; earnedRf: bigint; earnedWeth: bigint; wallet: Address | null; generation: number; hardwired: boolean; activated: boolean };

/**
 * Per Friend: `positions`, both `earned`, the token-bound wallet, and `generation` (Generations only: it reverts on
 * Genesis). `earned` reverts for a temporary Friend (not hardwired); their server reports 0 there, so do we.
 */
async function readPositions(owned: Owned[], blockNumber: bigint): Promise<Position[]> {
  const calls: Call[] = [];
  const slots: number[][] = [];
  for (const n of owned) {
    const collection = CONTRACTS[n.collection];
    const s = [
      calls.push({ address: CONTRACTS.ActivationManager, abi: AM_ABI, functionName: "positions", args: [collection, n.id] }) - 1,
      calls.push({ address: CONTRACTS.ActivationManager, abi: AM_ABI, functionName: "earned", args: [CONTRACTS.RF, collection, n.id] }) - 1,
      calls.push({ address: CONTRACTS.ActivationManager, abi: AM_ABI, functionName: "earned", args: [CONTRACTS.WETH, collection, n.id] }) - 1,
      calls.push({ address: collection, abi: NFT_ABI, functionName: "tokenBoundAccount", args: [n.id] }) - 1,
      n.collection === "Generations" ? calls.push({ address: collection, abi: NFT_ABI, functionName: "generation", args: [n.id] }) - 1 : -1,
    ];
    slots.push(s);
  }
  const r = await multicall(calls, blockNumber);
  return owned.map((n, i) => {
    const [pos, eRf, eWeth, tba, gen] = slots[i];
    const tag = `${n.collection} #${n.id}`;
    const [tier, weight] = must<readonly [number, bigint]>(r[pos], `positions ${tag}`);
    const generation = gen >= 0 ? Number(must<number>(r[gen], `generation ${tag}`)) : 0;
    // Their server's rule (readFriend): a Genesis is always hardwired, a Generations Friend once its generation is set;
    // a Friend is activated only while hardwired with reward weight above zero.
    const hardwired = n.collection === "Genesis" || generation > 0;
    const soft = <T,>(x: Result | undefined, fallback: T) => (x?.status === "success" ? (x.result as T) : fallback);
    return {
      owned: n,
      tier: Number(tier),
      weight,
      earnedRf: hardwired ? must<bigint>(r[eRf], `earned RF ${tag}`) : soft(r[eRf], 0n),
      earnedWeth: hardwired ? must<bigint>(r[eWeth], `earned WETH ${tag}`) : soft(r[eWeth], 0n),
      wallet: hardwired ? getAddress(must<Address>(r[tba], `wallet ${tag}`)) : soft<Address | null>(r[tba], null),
      generation,
      hardwired,
      activated: hardwired && weight > 0n,
    };
  });
}

type Balances = { eth: bigint; weth: bigint; rf: bigint };
/** ETH, WETH and RF held by each hardwired Friend's own wallet. */
async function readBalances(wallets: Address[], blockNumber: bigint): Promise<Balances[]> {
  const calls: Call[] = wallets.flatMap((w) => [
    { address: CONTRACTS.Multicall3, abi: MULTICALL_ABI, functionName: "getEthBalance", args: [w] },
    { address: CONTRACTS.WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [w] },
    { address: CONTRACTS.RF, abi: ERC20_ABI, functionName: "balanceOf", args: [w] },
  ]);
  const r = await multicall(calls, blockNumber);
  return wallets.map((w, i) => ({
    eth: must<bigint>(r[i * 3], `ETH balance ${w}`),
    weth: must<bigint>(r[i * 3 + 1], `WETH balance ${w}`),
    rf: must<bigint>(r[i * 3 + 2], `RF balance ${w}`),
  }));
}

/** The image inside an on-chain `tokenURI` (data: JSON with a data: SVG or PNG image), as their artwork reader decodes it. */
function decodeTokenUri(uri: unknown): string | undefined {
  if (typeof uri !== "string") return undefined;
  const m = /^data:application\/json(;base64)?,(.*)$/s.exec(uri);
  if (!m) return undefined;
  try {
    const text = m[1] ? Buffer.from(m[2], "base64").toString("utf8") : decodeURIComponent(m[2]);
    const image = (JSON.parse(text) as Raw)?.image;
    return typeof image === "string" && image.length <= IMG_MAX && /^data:image\/(svg\+xml|png)[;,]/i.test(image) ? image : undefined;
  } catch {
    return undefined;
  }
}

/** One Friend's portrait: `tokenURI` on chain, else their `nft-image` route (which reads the same thing). Undefined means the placeholder. */
export async function friendArtwork(collection: Collection, id: bigint | number | string, blockNumber?: bigint): Promise<string | undefined> {
  const tokenId = BigInt(id);
  try {
    const uri = await reads.readContract({ address: CONTRACTS[collection], abi: NFT_ABI, functionName: "tokenURI", args: [tokenId], blockNumber });
    const image = decodeTokenUri(uri);
    if (image) return image;
  } catch {
    // fall through to their route
  }
  try {
    const j = await readJson("nft-image", `${ARTWORK_API}?id=${tokenId}&collection=${collection}&format=json`, 6_000);
    const image = isObj(j) ? j.image : undefined;
    return typeof image === "string" && image.length <= IMG_MAX && /^data:image\/(svg\+xml|png)[;,]/i.test(image) ? image : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Portraits for the first `ART_MAX` Friends in display order, a few at a time, until the byte budget is spent or
 * `budgetMs` runs out. Portraits never hold the numbers hostage: whatever arrived by the deadline is attached.
 */
async function readArtwork(order: Owned[], blockNumber: bigint, budgetMs: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const queue = order.slice(0, ART_MAX);
  let bytes = 0;
  let open = true;
  const artStarted = Date.now();
  const worker = async () => {
    for (let n = queue.shift(); n && open; n = queue.shift()) {
      if (bytes > ART_BYTES) return;
      const image = await friendArtwork(n.collection, n.id, blockNumber);
      if (image && bytes + image.length <= ART_BYTES) {
        bytes += image.length;
        out.set(`${n.collection}:${n.id}`, image);
      }
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(Array.from({ length: ART_CONCURRENCY }, worker)), new Promise((r) => (timer = setTimeout(r, Math.max(0, budgetMs))))]);
  clearTimeout(timer);
  open = false;
  note({ stage: "art", ms: Date.now() - artStarted, ok: true, note: `${out.size} of ${Math.min(order.length, ART_MAX)} portraits within the budget` });
  return new Map(out);
}

/** Sum of `payment` over the holder's `Activated` events in [from, to], from one endpoint. Throws on any error or undecodable log. */
async function chunkPaidOn(url: string, holder: Address, from: bigint, to: bigint, signal: AbortSignal): Promise<bigint> {
  const t0 = Date.now();
  try {
    const sum = await chunkPaidOnRaw(url, holder, from, to, signal);
    note({ stage: "logs", host: hostOf(url), method: `eth_getLogs ${from}-${to}`, ms: Date.now() - t0, ok: true });
    return sum;
  } catch (e) {
    const aborted = signal.aborted && (e as Error)?.name === "AbortError";
    note({ stage: "logs", host: hostOf(url), method: `eth_getLogs ${from}-${to}`, ms: Date.now() - t0, ok: aborted, error: errText(e), note: aborted ? "cancelled: another endpoint answered first" : undefined });
    throw e;
  }
}
async function chunkPaidOnRaw(url: string, holder: Address, from: bigint, to: bigint, signal: AbortSignal): Promise<bigint> {
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "User-Agent": UA },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [{ address: CONTRACTS.ActivationManager, topics: encodeEventTopics({ abi: [ACTIVATED], args: { holder } }), fromBlock: toHex(from), toBlock: toHex(to) }],
    }),
  });
  const text = await res.text().catch(() => "");
  let j: { result?: unknown; error?: { message?: string } } | null = null;
  try {
    j = JSON.parse(text);
  } catch {
    // not JSON (a firewall page): reported below with the body
  }
  if (!res.ok || !j || !Array.isArray(j.result)) throw new UpstreamError(`${hostOf(url)} eth_getLogs ${res.status}: ${j?.error?.message ?? snippet(text)}`);
  const events = parseEventLogs({ abi: [ACTIVATED], logs: j.result as Log[], strict: true });
  if (events.length !== j.result.length) throw new UpstreamError("undecodable Activated log");
  let total = 0n;
  for (const e of events) {
    if (e.address.toLowerCase() !== CONTRACTS.ActivationManager.toLowerCase() || e.args.holder.toLowerCase() !== holder.toLowerCase() || e.args.payment < 0n) throw new UpstreamError("unexpected Activated log");
    total += e.args.payment;
  }
  return total;
}

/**
 * One chunk from the first log endpoint that answers. The next endpoint starts when the current one fails or has been
 * silent for LOG_HEDGE_MS; the first success wins and aborts the rest. An endpoint that reports the range too dense
 * settles it too: the range is split into LOG_DENSE_PARTS parts, each read the same way but chain RPC first, one
 * after the other (the chain RPC answers 429 to bursts), down to LOG_MIN_SPLIT; the range is remembered as dense. A 429 is retried on the same endpoint after a short backoff (at most
 * LOG_429_RETRIES times). Rejects only when every endpoint failed and none is waiting to retry.
 */
function hedgedChunkPaid(holder: Address, from: bigint, to: bigint, chainFirst = false): Promise<bigint> {
  if (denseRanges.has(`${from}-${to}`)) return densePaid(holder, from, to);
  const urls = [...new Set([envRpc(), ...(chainFirst ? [RPC_URL, ...LOG_RPCS] : LOG_RPCS)].filter((u): u is string => !!u))];
  return new Promise((resolve, reject) => {
    const stop = new AbortController();
    const errors: string[] = [];
    const retries = new Map<string, number>();
    let next = 0;
    let running = 0;
    let waiting = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      stop.abort();
    };
    const attempt = (url: string) => {
      running++;
      chunkPaidOn(url, holder, from, to, AbortSignal.any([stop.signal, AbortSignal.timeout(LOG_ATTEMPT_MS)])).then(
        (sum) => {
          if (settled) return;
          finish();
          resolve(sum);
        },
        (e: unknown) => {
          running--;
          const message = String((e as Error)?.message ?? e);
          errors.push(message.slice(0, 120));
          if (settled) return;
          if (DENSE_RANGE.test(message) && to - from + 1n > LOG_MIN_SPLIT) {
            finish();
            denseRanges.add(`${from}-${to}`);
            densePaid(holder, from, to).then(resolve, reject);
            return;
          }
          const tried = retries.get(url) ?? 0;
          if (RATE_LIMITED.test(message) && tried < LOG_429_RETRIES) {
            retries.set(url, tried + 1);
            waiting++;
            setTimeout(() => {
              waiting--;
              if (!settled) attempt(url);
            }, LOG_429_BACKOFF_MS * (tried + 1));
          }
          if (next < urls.length) launch();
          else if (running === 0 && waiting === 0) {
            finish();
            reject(new UpstreamError(`activation history ${from}-${to}: ${errors.join("; ")}`));
          }
        }
      );
    };
    const launch = () => {
      clearTimeout(timer);
      if (settled || next >= urls.length) return;
      const url = urls[next++];
      timer = setTimeout(launch, LOG_HEDGE_MS);
      attempt(url);
    };
    launch();
  });
}

/** A dense range in LOG_DENSE_PARTS parts (never below LOG_MIN_SPLIT), one after the other, chain RPC first. */
async function densePaid(holder: Address, from: bigint, to: bigint): Promise<bigint> {
  const size = to - from + 1n;
  const part = size / LOG_DENSE_PARTS > LOG_MIN_SPLIT ? size / LOG_DENSE_PARTS : LOG_MIN_SPLIT;
  note({ stage: "logs", method: `split ${from}-${to}`, ms: 0, ok: true, note: `range too dense for one query: reading it in parts of ${part} blocks` });
  let sum = 0n;
  for (let a = from; a <= to; a += part) sum += await hedgedChunkPaid(holder, a, a + part - 1n < to ? a + part - 1n : to, true);
  return sum;
}

/**
 * A sealed chunk's sum, shared across instances and deploys through Next's Data Cache for a day (a stale entry is
 * served at once and refreshed behind it). Outside a Next request (scripts) there is no cache: read it directly.
 */
const sealedShared = unstable_cache(async (holder: string, from: string, to: string) => String(await hedgedChunkPaid(holder as Address, BigInt(from), BigInt(to))), ["rf-activated-chunk-v1"], { revalidate: 86_400 });
async function sealedChunkPaidShared(holder: Address, from: bigint, to: bigint): Promise<bigint> {
  let v: unknown;
  try {
    v = await sealedShared(holder.toLowerCase(), String(from), String(to));
  } catch (e) {
    if (/incrementalCache missing/.test(String((e as Error)?.message))) return hedgedChunkPaid(holder, from, to);
    note({ stage: "chunk-cache", method: `${from}-${to}`, ms: 0, ok: false, error: errText(e) });
    throw e;
  }
  if (typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v)) return BigInt(v);
  // A Data Cache entry of the wrong shape: say so, and read the chunk directly rather than trust it.
  note({ stage: "chunk-cache", method: `${from}-${to}`, ms: 0, ok: false, error: `unexpected cached value (${typeof v}): ${snippet(JSON.stringify(v) ?? "undefined")}` });
  return hedgedChunkPaid(holder, from, to);
}
/** In-process layer over it: concurrent requests (a page and its PNG) share one read, and a read still running when a card gave up lands here for the next one. */
const sealedMemo = new Map<string, Promise<bigint>>();
const SEALED_MEMO_MAX = 20_000;
function sealedChunkPaid(holder: Address, from: bigint, to: bigint): Promise<bigint> {
  const key = `${holder.toLowerCase()}:${from}`;
  const held = sealedMemo.get(key);
  if (held) return held;
  const read = sealedChunkPaidShared(holder, from, to);
  read.catch(() => sealedMemo.get(key) === read && sealedMemo.delete(key));
  sealedMemo.set(key, read);
  if (sealedMemo.size > SEALED_MEMO_MAX) sealedMemo.delete(sealedMemo.keys().next().value as string);
  return read;
}

const paidCache = new Map<string, { paid: bigint; at: number }>();
/**
 * RF this wallet has paid to activate or upgrade Friends: the sum of `payment` over its `Activated` events up to
 * `head`, exactly as their previous server computed it. The history is append-only, so it is read in aligned chunks:
 * sealed chunks come from the caches above and only the open chunk at the head is read every time (recent blocks
 * answer in about 100 ms). Waits at most `budgetMs`. Payments only ever accrue, so a copy up to an hour old stands in
 * when the history cannot be read in time; null means unknown, and the cards must say so rather than print "no RF paid".
 */
async function readActivationPaid(address: Address, head: bigint, budgetMs: number): Promise<bigint | null> {
  const key = address.toLowerCase();
  const held = paidCache.get(key);
  const now = Date.now();
  if (held && now - held.at < PAID_FRESH_MS) return held.paid;
  try {
    const parts: Promise<bigint>[] = [];
    for (let from = ACTIVATION_FROM_BLOCK; from <= head; from += LOG_CHUNK) {
      const end = from + LOG_CHUNK - 1n;
      parts.push(end + LOG_SEAL_MARGIN <= head ? sealedChunkPaid(address, from, end) : hedgedChunkPaid(address, from, head));
    }
    const total = (await withDeadline(Promise.all(parts), budgetMs)).reduce((a, b) => a + b, 0n);
    paidCache.set(key, { paid: total, at: now });
    note({ stage: "paid", ms: Date.now() - now, ok: true, note: `${parts.length} chunks, budget ${budgetMs} ms` });
    return total;
  } catch (e) {
    const stale = held && now - held.at < PAID_STALE_MS;
    note({ stage: "paid", ms: Date.now() - now, ok: false, error: errText(e), note: stale ? "served a copy under an hour old" : "activation history unknown (soft: the card still renders)" });
    return stale ? held.paid : null;
  }
}

/**
 * A state assembled before its activation history arrived (`activationPaidUnknown`): waits up to `budgetMs` more on
 * the same history read, whose chunks are still in flight and shared through the caches above, and returns a copy
 * with the total filled in. Null when it is still unknown; the caller keeps the state it had.
 */
export async function fillActivationPaid(raw: Raw, budgetMs: number): Promise<Raw | null> {
  const acct = raw?.account;
  if (!acct?.activationPaidUnknown || budgetMs <= 0 || typeof acct.address !== "string" || !/^[0-9]+$/.test(String(raw.blockNumber))) return null;
  const paid = await readActivationPaid(getAddress(acct.address), BigInt(raw.blockNumber), budgetMs);
  if (paid == null) return null;
  return { ...raw, account: { ...acct, activationPaid: units(paid), activationPaidUnknown: false } };
}

/**
 * A wallet's activation total at the current head, waiting up to `budgetMs`: the history's own route, which a cold
 * card page calls from the browser so a slow history finishes (and lands in the caches) outside the page's budget.
 */
export async function readActivationPaidNow(address: string, budgetMs: number): Promise<number | null> {
  const head = await reads.getBlockNumber({ cacheTime: 0 });
  const paid = await readActivationPaid(getAddress(address), head, budgetMs);
  return paid == null ? null : units(paid);
}

/** Their `rewardApyPercent` on their published totals: this week's active budgets, priced, over all RF ever paid to activate, annualized. */
function protocolApr(totalPaid: bigint | null, snapshot: Snapshot, nowMs: number): number {
  if (totalPaid == null || totalPaid <= 0n) return 0;
  const paidUsd = units(totalPaid) * snapshot.prices.rfUsd;
  if (!(paidUsd > 0)) return 0;
  const weekly = snapshot.streams.reduce((a, s) => a + (s.end > nowMs ? s.budget : 0) * (s.asset === "RF" ? snapshot.prices.rfUsd : snapshot.prices.ethUsd), 0);
  return (weekly / paidUsd) * (365 / 7) * 100;
}

const safeId = (id: bigint) => (id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : String(id));

/**
 * One wallet's state in the shape rarefriends.com's retired `/api/protocol/state` returned. Throws on any hard
 * failure (an upstream route down, a Friend whose chain reads failed, a missing price); a `TimeoutError` when the
 * whole read outruns `timeoutMs`. Portraits and the activation history are soft: a missing portrait is a placeholder,
 * an unknown activation total is flagged `activationPaidUnknown`.
 */
export async function assembleState(address: string, timeoutMs: number, trace?: Trace): Promise<Raw> {
  const addr = getAddress(address);
  const t = trace ?? newTrace(addr);
  return traceStore.run(t, () => assembleTraced(addr, timeoutMs));
}
async function assembleTraced(addr: Address, timeoutMs: number): Promise<Raw> {
  const started = Date.now();
  const run = async () => {
    // `eth_blockNumber` is served by every transport (their proxy refuses `eth_getBlockByNumber`); blocks are 100 ms
    // apart, so the wall clock is the block time for every purpose here (freshness, stream end, APR).
    const head = step("block", () => reads.getBlockNumber({ cacheTime: 0 }), (b) => String(b));
    // The activation history is the slowest read and needs only the head, so it starts as soon as the head is known
    // and runs alongside the snapshot, the Friend list and the position reads. It used to start after the positions,
    // which on a wallet of 400 Friends left it a second or two and printed "activation history unavailable".
    const paidRead = head.then((b) => readActivationPaid(addr, b, Math.max(0, timeoutMs - (Date.now() - started) - 1_000)), () => null);
    const [snapshot, owned, block, totalPaid] = await Promise.all([
      step("snapshot", () => readSnapshot(6_000)),
      step("owned-nfts", () => readOwned(addr, 8_000), (o) => `${o.length} Friends`),
      head,
      readTotalsPaid(4_000),
    ]);
    const nowMs = Date.now();
    const positions = await step("positions", () => readPositions(owned, block));
    const hardwired = positions.filter((p): p is Position & { wallet: Address } => p.hardwired && p.wallet !== null);
    // Portraits get what is left of the caller's budget, less a second to build the state, so a slow portrait render
    // degrades to a placeholder instead of failing the whole card. The history already has its own deadline.
    const soft = Math.max(0, Math.min(ART_BUDGET_MS, timeoutMs - (Date.now() - started) - 1_000));
    const [balances, paid, art] = await Promise.all([
      step("balances", () => readBalances(hardwired.map((p) => p.wallet), block)),
      paidRead,
      readArtwork([...positions.filter((p) => p.activated), ...positions.filter((p) => !p.activated)].map((p) => p.owned), block, soft),
    ]);
    const balanceOf = new Map(hardwired.map((p, i) => [p.wallet, balances[i]]));
    const { ethUsd, rfUsd } = snapshot.prices;
    const friends = positions.map((p) => {
      const b = p.hardwired && p.wallet ? balanceOf.get(p.wallet) : undefined;
      const tokens = b
        ? [
            { symbol: "ETH", name: "Ether", balance: units(b.eth), usd: units(b.eth) * ethUsd },
            { symbol: "WETH", name: "Wrapped Ether", balance: units(b.weth), usd: units(b.weth) * ethUsd },
            { symbol: "$RAREFRIENDS", name: "Rare Friends", balance: units(b.rf), usd: units(b.rf) * rfUsd },
          ].filter((t) => t.balance > 0)
        : [];
      const id = safeId(p.owned.id);
      return {
        id,
        collection: p.owned.collection,
        generation: p.generation,
        tier: p.activated ? p.tier : 0,
        activated: p.activated,
        hardwired: p.hardwired,
        earnings: units(p.earnedRf),
        earningsWeth: units(p.earnedWeth),
        portrait: Number(p.owned.id % (p.owned.collection === "Genesis" ? 32n : 8n)),
        weight: p.activated ? units(p.weight) : 0,
        wallet: p.hardwired && p.wallet ? { address: p.wallet, tokens, nfts: [], totalUsd: tokens.reduce((a, t) => a + t.usd, 0) } : null,
        imageUrl: art.get(`${p.owned.collection}:${p.owned.id}`),
      };
    });
    const streams = snapshot.streams.map((s) => ({ ...s, start: s.end - WEEK_MS, dripped: 0 }));
    const remaining = (asset: "RF" | "WETH") => streams.filter((s) => s.asset === asset).reduce((a, s) => a + Math.max(0, s.remaining) + s.pending, 0);
    const streamRemainingRf = remaining("RF");
    const streamRemainingWeth = remaining("WETH");
    return {
      account: {
        address: addr,
        friends,
        rewardAccounting: "friend",
        activationPaid: paid == null ? undefined : units(paid),
        activationPaidUnknown: paid == null,
        activity: [],
      },
      protocol: {
        metrics: {
          genesisWeight: snapshot.metrics.genesisWeight,
          generationsWeight: snapshot.metrics.generationsWeight,
          rewardApy: protocolApr(totalPaid, snapshot, nowMs),
          streamRemainingRf,
          streamRemainingWeth,
          streamRemainingUsd: streamRemainingRf * rfUsd + streamRemainingWeth * ethUsd,
        },
        streams,
        weekly: [],
        holderWeekly: [],
        prices: { ethUsd, rfUsd },
      },
      blockNumber: String(block),
      timestamp: nowMs,
    };
  };
  return step("assemble", () => withDeadline(run(), timeoutMs));
}
