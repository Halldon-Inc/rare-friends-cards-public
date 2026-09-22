import type { Metadata } from "next";
import Link from "next/link";
import { decodeParam, resolveInput, fetchState, claimableUsd, nextRewardUsd, friendShare, friendWeight, friendLabel, friendTitle, walletBalances, findFriend, friendSlug, displayName, walletSlug } from "@/lib/rarefriends";
import { usd, num, sharePct } from "@/lib/format";
import { baseUrl } from "@/lib/site";
import { CopyLink } from "@/components/CopyLink";
import { DownloadCard } from "@/components/DownloadCard";
import { Problem } from "@/components/Problem";
import { renderCardPng } from "@/lib/render";
import { FriendCard, FRIEND_W, FRIEND_H } from "@/components/cards/FriendCard";

export const dynamic = "force-dynamic";
export const maxDuration = 20;
type P = { params: Promise<{ address: string; id: string }> };

const TAGLINE = "Friends have wallets. Wallets have Friends. Friends collect crypto.";

// Share tags depend only on the address resolving and the id looking like one, never on rarefriends.com answering:
// a scraper that arrives during an upstream blip must still find the image URL, not cache a blank stub for days.
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { address, id } = await params;
  const raw = decodeParam(address);
  const addr = await resolveInput(raw);
  const idOk = /^(?:(?:genesis|gen|generations)-)?\d+$/i.test(id);
  if (!addr || addr === "ens-unavailable" || !idOk) return { title: "Rare Friends Cards", robots: { index: false, follow: false } };
  const s = await fetchState(addr);
  const f = s ? findFriend(s, id) : undefined;
  if (s && !f) return { title: "Rare Friends Cards", robots: { index: false, follow: false } };
  // Upstream down: keep the share tags (scrapers need the image URL) but do not let search engines index a page
  // whose Friend we could not confirm exists.
  const robots = s ? undefined : { index: false, follow: true };
  const base = baseUrl();
  const label = f ? friendTitle(f) : `Rare Friend #${id.replace(/^\D+-/, "")}`;
  const title = `${label} · Rare Friends`;
  const url = `${base}/card/${walletSlug(raw, addr)}/${s && f ? friendSlug(s, f) : id}`;
  const img = `${url}/og`;
  const alt = `Rare Friends card for ${label}: rewards to claim, pending, weight and NFT wallet`;
  return {
    title,
    description: TAGLINE,
    robots,
    alternates: { canonical: url },
    openGraph: { title, description: TAGLINE, url, siteName: "Rare Friends Cards", type: "website", images: [{ url: img, width: 1200, height: 630, type: "image/png", alt }] },
    twitter: { card: "summary_large_image", title, description: TAGLINE, images: [{ url: img, alt }] },
  };
}

export default async function Page({ params }: P) {
  const { address, id } = await params;
  const raw = decodeParam(address);
  const addr = await resolveInput(raw);
  if (addr === "ens-unavailable") return <Problem title="ENS lookup is down" body="Couldn't reach an Ethereum RPC to resolve that name. Paste the 0x address instead, or try again in a minute." />;
  if (!addr) return <Problem title="Not a wallet address" body="That isn't a 0x address or an ENS name that resolves." />;
  const name = displayName(raw, addr);
  // A Friend id is digits with an optional collection prefix; anything else fails here, before any upstream call.
  if (!/^(?:(?:genesis|gen|generations)-)?\d+$/i.test(id)) return <Problem title="Friend not found" body={`"${id}" isn't a Friend id.`} />;
  const s = await fetchState(addr);
  if (!s) return <Problem title="Rare Friends data unavailable" body="rarefriends.com didn't answer, or its price feed is down. Try again in a minute." />;
  const f = findFriend(s, id);
  if (!f) return <Problem title="Friend not found" body={`#${id} isn't in ${name}.`} />;
  const slug = walletSlug(raw, addr);
  const link = `${baseUrl()}/card/${slug}/${friendSlug(s, f)}`;
  // Rendered here from the same snapshot as the strip below and embedded inline, so the two cannot disagree.
  const { png: bytes } = await renderCardPng(<FriendCard s={s} f={f} name={name} />, FRIEND_W, FRIEND_H);
  const png = `data:image/png;base64,${bytes.toString("base64")}`;
  const w = walletBalances(f);

  return (
    <main className="wrap" id="main">
      <header className="pagehead">
        <h1 className="px">{friendLabel(f).toUpperCase()} #{f.id}</h1>
        <Link className="chip" href={`/card/${slug}`}>[ ← all friends ]</Link>
      </header>

      <section className="cardblock">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="card" src={png} alt={`Card for ${friendTitle(f)}`} width={1200} height={630} />
        <div className="actions">
          <CopyLink url={link} />
          <DownloadCard filename={`rarefriends-${friendLabel(f).toLowerCase()}-${f.id}.png`} />
        </div>
      </section>

      <section className="strip four">
        <div className="cell"><span className="lbl">to claim</span><b>{usd(claimableUsd(s, f))}</b><small>{num(f.earnings ?? 0, 3)} RF + {num(f.earningsWeth ?? 0, 6)} WETH</small></div>
        <div className="cell"><span className="lbl">pending</span><b>{usd(nextRewardUsd(s, f))}</b><small>live estimate weight-based</small></div>
        <div className="cell"><span className="lbl">reward weight</span><b>{num(friendWeight(f), 6)}</b><small>{sharePct(friendShare(s, f) * 100)} of active weight</small></div>
        {w.exists ? (
          <div className="cell dark"><span className="lbl">NFT wallet</span><b>{usd(w.usd)}</b><small>{num(w.rf, 3)} RF · {num(w.weth, 6)} WETH</small></div>
        ) : (
          <div className="cell dark"><span className="lbl">NFT wallet</span><b>none yet</b><small>hardwire required</small></div>
        )}
      </section>

      {s.cached ? (
        <p className="foot notice" role="status">rarefriends.com is not answering right now. This is our last good copy, from block {s.blockNumber}{s.ageSeconds != null ? `, about ${Math.max(1, Math.round(s.ageSeconds / 60))} min ago` : ""}.</p>
      ) : null}
      <p className="foot muted">{s.cached ? "Cached copy from" : "Live from"} rarefriends.com · block {s.blockNumber}. Not affiliated with Rare Friends.</p>
    </main>
  );
}
