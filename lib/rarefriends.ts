import { createPublicClient, http, fallback, isAddress, getAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { after } from "next/server";

export const SITE = "https://rarefriends.com";
export const STATE_API = `${SITE}/api/protocol/state`;
const UA = "rare-friends-cards/1.0 (+https://rare-friends-cards.vercel.app)";

export type Token = { symbol?: string; balance?: number; usd?: number; [k: string]: unknown };
export type Friend = {
  id: number | string;
  collection: string; // "Genesis" | "Generations"
  generation: number;
  tier: number;
  activated: boolean;
  hardwired: boolean;
  earnings: number;
  earningsWeth: number;
  portrait?: number;
  weight: number;
  wallet?: { address?: string; tokens?: Token[]; nfts?: unknown[]; totalUsd?: number } | null;
  imageUrl?: string;
};
export type Weekly = { start: number; rf: number; weth: number; partial?: boolean };
export type Stream = { asset: "RF" | "WETH"; start: number; end: number; budget: number; dripped: number; pending: number; remaining: number };
export type State = {
  live: boolean;
  address: string;
  eth: number;
  weth: number;
  tokenBalance: number;
  friends: Friend[];
  activity: { claimed: number; claimedWeth: number; valueUsd: number; activationPaid: number; history?: unknown[] };
  /** "friend" (rewards live on each Friend) or "holder" (a wallet-level credit exists as well). */
  rewardAccounting?: string;
  rewardCredit?: number;
  rewardCreditWeth?: number;
  streams: Stream[];
  weekly: Weekly[];
  holderWeekly: Weekly[];
  metrics: {
    genesisWeight: number;
    generationsWeight: number;
    rewardApy: number;
    weekRewardsUsd: number;
    weekRewardsRf: number;
    weekRewardsWeth: number;
    streamRemainingUsd: number;
    streamRemainingRf: number;
    streamRemainingWeth: number;
    supplyBurned: number;
    vaultInventory: number;
  };
  prices: { ethUsd: number; rfUsd: number; usdAvailable?: boolean; usdStale?: boolean };
  blockNumber?: string;
  timestamp?: number;
  /** True when rarefriends.com did not answer and this is the last good snapshot we hold; ageSeconds says how old. */
  cached?: boolean;
  ageSeconds?: number;
};

// ===== input =====

const MAX_INPUT = 256;
/** ENS-shaped: two or more labels, no whitespace or slashes; viem's normalize() rejects anything that is not a valid name. */
export const ENS_NAME = /^[^\s./\\]{1,63}(\.[^\s./\\]{1,63})+$/u;
const HEX40 = /^0x[0-9a-fA-F]{40}$/;

// cloudflare-eth.com reverts on ENS universal-resolver calls (verified 2026-09-16); use RPCs that work, in order.
// No retries and short timeouts: an RPC outage must fail in seconds, not the 96 s viem's defaults allow.
const ens = createPublicClient({
  chain: mainnet,
  transport: fallback(
    [
      http("https://eth.merkle.io", { timeout: 4_000 }),
      http("https://ethereum-rpc.publicnode.com", { timeout: 4_000 }),
      http("https://eth.llamarpc.com", { timeout: 4_000 }),
    ],
    { retryCount: 0 }
  ),
});

// Resolved names are cached for an hour (misses too). A thrown RPC error is never cached.
const lookupEns = unstable_cache(async (name: string) => (await ens.getEnsAddress({ name })) ?? null, ["ens-v1"], { revalidate: 3600 });

/** decodeURIComponent that never throws on malformed sequences (a bad %xx in the URL is just a bad address). */
export function decodeParam(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A checksummed address, null when the input is not a wallet, or "ens-unavailable" when every ENS RPC failed. */
export type Resolved = `0x${string}` | null | "ens-unavailable";

/** Accepts a 0x address (any case) or an ENS name. Memoised per request so metadata and page share one lookup. */
export const resolveInput = cache(async (input: string): Promise<Resolved> => {
  const q = input.trim();
  if (q.length === 0 || q.length > MAX_INPUT) return null;
  if (HEX40.test(q)) {
    const hex = q.slice(2);
    // All-lowercase and all-uppercase hex carry no checksum (wallet apps copy both); mixed case must checksum.
    if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return getAddress(q.toLowerCase());
    return isAddress(q) ? getAddress(q) : null;
  }
  if (ENS_NAME.test(q)) {
    let name: string;
    try {
      name = normalize(q);
    } catch {
      return null;
    }
    try {
      const a = await lookupEns(name);
      return a ? getAddress(a) : null;
    } catch {
      return "ens-unavailable";
    }
  }
  return null;
});

export const isEnsName = (raw: string) => ENS_NAME.test(raw.trim());
/** What to print for a wallet: the ENS name the visitor typed (when it fits), else the short 0x form. */
export function displayName(raw: string, addr: string) {
  const q = raw.trim().toLowerCase();
  return isEnsName(q) && q.length <= 24 ? q : short(addr);
}
/** Path segment to share: the typed ENS name (lowercased) or the checksummed address. */
export function walletSlug(raw: string, addr: string) {
  const q = raw.trim().toLowerCase();
  return isEnsName(q) ? encodeURIComponent(q) : addr;
}

/** Only image sources we expect from the API: inline data URIs or rarefriends.com itself, capped at 64 KB. Anything else renders the placeholder. */
const IMG_MAX = 64 * 1024;
export function safeImage(src?: string) {
  if (!src || src.length > IMG_MAX) return undefined;
  if (/^data:image\/(svg\+xml|png|jpeg|gif|webp)[;,]/i.test(src)) return src;
  if (/^https:\/\/([a-z0-9-]+\.)*rarefriends\.com\//i.test(src)) return src;
  return undefined;
}

// ===== upstream =====

/** A snapshot is "fresh" when the API's own timestamp is this recent. Robinhood Chain moves about 10 blocks a second. */
const FRESH_MS = 45_000;
/** Shared cache window for the fast path: everyone asking for the same wallet within it gets one identical snapshot. */
const SHARED_S = 30;

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Read = { json: Raw | null; hung: boolean };

/**
 * One upstream read. `shared` goes through Next's Data Cache (30 s, stale-while-revalidate, only 200s are stored, a
 * failed refresh never evicts good data); `!shared` bypasses every cache. Both are validated to the economy shape.
 */
async function readState(address: string, shared: boolean, timeoutMs: number): Promise<Read> {
  let res: Response;
  try {
    res = await fetch(`${STATE_API}?address=${address.toLowerCase()}`, {
      ...(shared ? { next: { revalidate: SHARED_S } } : { cache: "no-store" }),
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": UA, accept: "application/json" },
    });
  } catch (e) {
    return { json: null, hung: (e as { name?: string })?.name === "TimeoutError" };
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return { json: null, hung: false };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { json: null, hung: false };
  }
  if (!json || typeof json !== "object") return { json: null, hung: false };
  const j = json as Raw;
  // Shape (re-verified 2026-09-19, after the route moved from /api/postlaunch/state to /api/protocol/state):
  //   { account: {...friends, claimed, claimedWeth, activationPaid, activity: [], rewardAccounting, rewardCredit,
  //   rewardCreditWeth}, protocol: { metrics, streams, weekly, holderWeekly, prices, reserve, coverage, marketReady },
  //   blockNumber, timestamp }. `mode` is no longer sent; the guard stays as a net in case it returns, because in
  //   "genesis-only" mode the Friends have a different shape and must be refused.
  if (j.mode && j.mode !== "economy") return { json: null, hung: false };
  const acct = j.account ?? j;
  const proto = j.protocol ?? j ?? {};
  if (!acct || !Array.isArray(acct.friends)) return { json: null, hung: false };
  const prices = acct.prices ?? proto.prices ?? {};
  const metrics = acct.metrics ?? proto.metrics ?? {};
  // Missing prices or weights would make every number a confident zero; the site shows dashes then, we refuse.
  if (!(n(prices.rfUsd) > 0) || !(n(prices.ethUsd) > 0) || !(n(metrics.genesisWeight) + n(metrics.generationsWeight) > 0)) return { json: null, hung: false };
  // Upstream invariant, read from their source (rarefriends-web-public src/server/protocol/state.ts readFriend):
  // `weight` is always a number, and a Friend is only `activated` when its weight is above zero. So an
  // activated + hardwired Friend without weight cannot happen. Their CLIENT still carries a fallback that recomputes
  // weight from the tier tables, but that path is for previewing an upgrade before it is onchain, never for API data.
  // We deliberately do NOT copy those tables: a stale local copy of a protocol constant would print a confidently
  // wrong number, which is worse than showing none. If the invariant ever breaks, refuse the snapshot instead of
  // rendering 0 weight and 0% share on a card somebody screenshots.
  if (acct.friends.some((f: Raw) => f && f.activated && f.hardwired && !(n(f.weight) > 0))) return { json: null, hung: false };
  return { json: j, hung: false };
}

const ageMs = (j: Raw) => (typeof j.timestamp === "number" ? Date.now() - j.timestamp : Infinity);

// Last good snapshot per wallet, per function instance. A page and the PNG it embeds arrive a second apart and usually
// land on the same warm instance, so they read one identical snapshot even when the upstream is failing every other
// call. Bounded: a snapshot with 37 Friends is a few hundred KB.
const MEMO_MAX = 40;
const memo = new Map<string, Raw>();
function remember(address: string, j: Raw) {
  const k = address.toLowerCase();
  memo.delete(k);
  memo.set(k, j);
  if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
}

/**
 * Reads rarefriends.com's state for a wallet.
 * 1. A snapshot this instance already holds, if the API's own timestamp is under 45 s old.
 * 2. Shared 30 s snapshot (Next Data Cache), accepted on the same freshness test: a burst of visitors costs one call.
 * 3. Otherwise (first visitor after an idle gap, when Next's cache would hand out an hours-old entry) read fresh,
 *    bypassing every cache, with quick retries: the API returns transient 502s ("chain request could not be
 *    completed") a few percent of the time, half the time on bad nights.
 * 4. If every read fails and an older snapshot exists, render it flagged `cached` with its age, so the card says so.
 * Null means "do not render". Memoised per request so metadata and page share one call.
 */
export const fetchState = cache(async (address: string): Promise<State | null> => {
  const held = memo.get(address.toLowerCase());
  if (held && ageMs(held) < FRESH_MS) return build(held, false);
  const shared = await readState(address, true, 8_000);
  if (shared.json && ageMs(shared.json) < FRESH_MS) {
    remember(address, shared.json);
    return build(shared.json, false);
  }
  let fresh: Read = { json: null, hung: shared.hung };
  // If the upstream is hanging rather than failing fast, do not stack more long waits on top.
  for (const timeout of fresh.hung ? [] : [8_000, 5_000, 5_000]) {
    fresh = await readState(address, false, timeout);
    if (fresh.json || fresh.hung) break;
    await new Promise((r) => setTimeout(r, 600));
  }
  if (fresh.json) {
    remember(address, fresh.json);
    // Seed the shared cache after the response so other instances get a recent copy too (fresh reads bypass it).
    // `after` keeps the function alive for this; a bare promise is not guaranteed to run once the response is sent.
    try {
      after(() => readState(address, true, 8_000).catch(() => {}));
    } catch {
      // Outside a request scope (tests, scripts): skip the seed.
    }
    return build(fresh.json, false);
  }
  const fallback = [held, shared.json].filter((x): x is Raw => !!x).sort((a, b) => ageMs(a) - ageMs(b))[0];
  return fallback ? build(fallback, true) : null;
});

function build(j: Raw, cached: boolean): State {
  const acct = j.account ?? j;
  const proto = j.protocol ?? j ?? {};
  const prices = acct.prices ?? proto.prices ?? {};
  const metrics = acct.metrics ?? proto.metrics ?? {};
  const activity =
    acct.activity && !Array.isArray(acct.activity)
      ? acct.activity
      : {
          claimed: acct.claimed,
          claimedWeth: acct.claimedWeth,
          valueUsd: acct.valueUsd,
          activationPaid: acct.activationPaid,
          history: Array.isArray(acct.activity) && acct.activity.length ? acct.activity : acct.history,
        };
  return {
    ...acct,
    activity,
    metrics,
    streams: acct.streams ?? proto.streams ?? [],
    weekly: acct.weekly ?? proto.weekly ?? [],
    holderWeekly: acct.holderWeekly ?? proto.holderWeekly ?? [],
    prices,
    blockNumber: j.blockNumber ?? proto.reserve?.blockNumber,
    timestamp: j.timestamp,
    cached,
    ageSeconds: cached && isFinite(ageMs(j)) ? Math.max(0, Math.round(ageMs(j) / 1000)) : undefined,
  } as State;
}

/** Footer stamp for the cards: the block the numbers came from; "cached copy" replaces the source name when rarefriends.com was not answering (keeps the Friend card footer under 700 px). */
export function blockStamp(s: State) {
  const block = s.blockNumber ? `block ${s.blockNumber}` : "";
  return [s.cached ? "cached copy" : "rarefriends.com", block].filter(Boolean).join(" · ");
}

// ===== derived numbers, the site's own formulas =====

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

// The formulas below mirror rarefriends.com's own portfolio code (getRewardOutlook / holderApyPercent / friendWeight,
// read from their now-public source at github.com/spokesz/rarefriends-web-public) so our numbers match the site's
// portfolio page. Re-verified 2026-09-20 against src/features/portfolio/analytics-data.ts at their commit 64a120e.

export function totalWeight(s: State) {
  return n(s.metrics?.genesisWeight) + n(s.metrics?.generationsWeight);
}

/** Site's friendWeight: a Friend only carries reward weight while it is activated AND hardwired. */
export function friendWeight(f: Friend) {
  return f.activated && f.hardwired ? n(f.weight) : 0;
}
export const isEarning = (f: Friend) => friendWeight(f) > 0;

export function holderWeight(s: State) {
  return (s.friends ?? []).reduce((a, f) => a + friendWeight(f), 0);
}

export function friendShare(s: State, f: Friend) {
  const t = totalWeight(s);
  return t > 0 ? Math.min(1, friendWeight(f) / t) : 0;
}

export function holderShare(s: State) {
  const t = totalWeight(s);
  return t > 0 ? Math.min(1, holderWeight(s) / t) : 0;
}

export function claimableUsd(s: State, f: Friend) {
  return n(f.earnings) * n(s.prices?.rfUsd) + n(f.earningsWeth) * n(s.prices?.ethUsd);
}

const price = (s: State, asset: string) => (asset === "RF" ? n(s.prices?.rfUsd) : n(s.prices?.ethUsd));
/** Site: max(0, remaining ?? budget - dripped). */
const streamRemaining = (st: Stream) => Math.max(0, st.remaining != null ? n(st.remaining) : n(st.budget) - n(st.dripped));

/** Site's "Pending" (nextUsd): (remaining + pending) of every stream × share, priced in USD. */
export function pendingUsdForShare(s: State, share: number) {
  return (s.streams ?? []).reduce((a, st) => a + (streamRemaining(st) + n(st.pending)) * share * price(s, st.asset), 0);
}

export function nextRewardUsd(s: State, f: Friend) {
  return pendingUsdForShare(s, friendShare(s, f));
}

/**
 * The active stream's weekly budget, priced: (budget while the stream is live) × weight ÷ total × price.
 * Pending fees are NOT in this number: rarefriends.com dropped them from the APR numerator on 2026-09-20
 * (their commit 0a056d3, "Change to APR based on current active stream"). They are still in "Pending"
 * (pendingUsdForShare / their getRewardOutlook), which that change left alone.
 */
function weeklyBudgetUsdForWeight(s: State, weight: number, now: number) {
  const t = totalWeight(s);
  if (!(t > 0)) return 0;
  return (s.streams ?? []).reduce((a, st) => a + (n(st.end) > now ? n(st.budget) : 0) * (weight / t) * price(s, st.asset), 0);
}

/** RF paid to activate, exactly as the API reports it (token units; the site reads it raw too). */
export const activationPaid = (s: State) => n(s.activity?.activationPaid);

/**
 * Site's holderApyPercent (their "Your APR"): for each stream, this week's budget while the stream is live
 * × holder weight ÷ total weight × price, summed, ÷ (RF paid to activate × RF price), × 365/7, as a percentage.
 * Null when nothing was paid to activate (the site shows a dash there). Can be exactly 0 (paid, nothing earning).
 */
export function holderApyPercent(s: State, now = Date.now()) {
  const paid = activationPaid(s);
  const rf = n(s.prices?.rfUsd);
  if (!(paid > 0) || !(rf > 0) || !(n(s.prices?.ethUsd) > 0) || !(totalWeight(s) > 0)) return null;
  return (weeklyBudgetUsdForWeight(s, holderWeight(s), now) / (paid * rf)) * (365 / 7) * 100;
}

/** Reward weight a Genesis carries once activated, and what activation costs (site docs: 2,000,000 and 100,000 RF). */
export const GENESIS_WEIGHT = 2_000_000;
export const GENESIS_ACTIVATION_RF = 100_000;

/** The site's holder formula applied to exactly one activated Genesis: what a Genesis earns on its 100,000 RF. */
export function genesisApyPercent(s: State, now = Date.now()) {
  const rf = n(s.prices?.rfUsd);
  if (!(rf > 0) || !(n(s.prices?.ethUsd) > 0) || !(totalWeight(s) > 0)) return null;
  return (weeklyBudgetUsdForWeight(s, GENESIS_WEIGHT, now) / (GENESIS_ACTIVATION_RF * rf)) * (365 / 7) * 100;
}

/** The API prints the token as "$RAREFRIENDS"; older notes said "RF". Match both, with or without the dollar sign. */
export function walletBalances(f: Friend) {
  const t = f.wallet?.tokens ?? [];
  const norm = (s?: string) => (s ?? "").toUpperCase().replace(/^\$/, "");
  const sum = (...syms: string[]) => t.filter((x) => syms.includes(norm(x.symbol))).reduce((a, x) => a + n(x.balance), 0);
  return { rf: sum("RAREFRIENDS", "RF"), weth: sum("WETH"), eth: sum("ETH"), usd: n(f.wallet?.totalUsd), exists: !!f.wallet };
}

export function portfolio(s: State) {
  const friends = s.friends ?? [];
  const earning = friends.filter(isEarning);
  const inactive = friends.filter((f) => !isEarning(f));
  let claimRf = friends.reduce((a, f) => a + n(f.earnings), 0);
  let claimWeth = friends.reduce((a, f) => a + n(f.earningsWeth), 0);
  // Site: under holder accounting the wallet-level credit is claimable too (today accounting is "friend").
  if (s.rewardAccounting && s.rewardAccounting !== "friend") {
    claimRf += n(s.rewardCredit);
    claimWeth += n(s.rewardCreditWeth);
  }
  const claimUsd = claimRf * n(s.prices?.rfUsd) + claimWeth * n(s.prices?.ethUsd);
  const pendingUsd = pendingUsdForShare(s, holderShare(s));
  const apy = holderApyPercent(s);
  const genesis = friends.filter((f) => f.collection === "Genesis").length;
  const walletUsd = friends.reduce((a, f) => a + n(f.wallet?.totalUsd), 0);
  const rfBudget = n(s.streams?.find((x) => x.asset === "RF")?.budget);
  const wethBudget = n(s.streams?.find((x) => x.asset === "WETH")?.budget);
  const claimedUsd = n(s.activity?.claimed) * n(s.prices?.rfUsd) + n(s.activity?.claimedWeth) * n(s.prices?.ethUsd);
  return { friends, earning, inactive, claimRf, claimWeth, claimUsd, pendingUsd, apy, paid: activationPaid(s), genesis, generations: friends.length - genesis, walletUsd, rfBudget, wethBudget, claimedUsd };
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Filename-safe short form (no ellipsis). */
export const shortPlain = (a: string) => `${a.slice(0, 6)}-${a.slice(-4)}`;

// Labels copied from the site: "Genesis", "Temp" for a Generations Friend that is not hardwired, else "Gen-N";
// tier reads "tier N / 4"; the full title is "Gen-N Generations #id" (or "Generations #id" while temporary).
export const isTemp = (f: Friend) => f.collection !== "Genesis" && !f.hardwired;
export function friendLabel(f: Friend) {
  return f.collection === "Genesis" ? "Genesis" : isTemp(f) ? "Temp" : `Gen-${f.generation}`;
}
export function friendTierLabel(f: Friend) {
  return f.collection === "Genesis" ? "1 of 1,024" : isTemp(f) ? "temporary" : `tier ${f.tier} / 4`;
}
export function friendTitle(f: Friend) {
  return f.collection === "Genesis" ? `Genesis #${f.id}` : `${isTemp(f) ? "" : `Gen-${f.generation} `}Generations #${f.id}`;
}
/** Site's list-row status line. */
export function friendStatus(f: Friend) {
  return isEarning(f) ? "earning" : isTemp(f) ? "temporary · balance-dependent" : "not activated";
}

// Genesis and Generations ids overlap numerically, and one wallet can hold both #N. Plain "<id>" prefers the Genesis;
// "gen-<id>" / "genesis-<id>" pick a collection. Links use the prefix only when a wallet actually has the collision.
export function findFriend(s: State, param: string): Friend | undefined {
  const m = /^(?:(genesis|gen|generations)-)?(\d+)$/i.exec(param.trim());
  if (!m) return undefined;
  const want = m[1] ? (m[1].toLowerCase() === "genesis" ? "Genesis" : "Generations") : undefined;
  const same = (s.friends ?? []).filter((f) => String(f.id) === m[2] && (!want || f.collection === want));
  return same.find((f) => f.collection === "Genesis") ?? same[0];
}
export function friendSlug(s: State, f: Friend) {
  const dup = (s.friends ?? []).some((x) => x !== f && String(x.id) === String(f.id));
  return dup && f.collection !== "Genesis" ? `gen-${f.id}` : String(f.id);
}
