import type { Metadata } from "next";
import Link from "next/link";
import { decodeParam, resolveInput, fetchState, portfolio, short, shortPlain, claimableUsd, safeImage, friendWeight, friendLabel, friendStatus, friendSlug, isTemp, displayName, walletSlug } from "@/lib/rarefriends";
import { usd, num, pct, apyPct } from "@/lib/format";
import { baseUrl } from "@/lib/site";
import { CopyLink } from "@/components/CopyLink";
import { DownloadCard } from "@/components/DownloadCard";
import { Problem } from "@/components/Problem";
import { renderCardPng } from "@/lib/render";
import { PortfolioCard, PORTFOLIO_W, PORTFOLIO_H } from "@/components/cards/PortfolioCard";

// Rendered on every request from a fresh upstream read (see lib/rarefriends.ts). 20 s covers one retry plus a render.
export const dynamic = "force-dynamic";
export const maxDuration = 20;
type P = { params: Promise<{ address: string }> };

const TAGLINE = "Friends have wallets. Wallets have Friends. Friends collect crypto.";

// Share tags depend only on the address resolving, never on rarefriends.com answering: a scraper that arrives during an
// upstream blip must still find the image URL (the CDN or a retry serves it), not cache a blank text stub for days.
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { address } = await params;
  const raw = decodeParam(address);
  const addr = await resolveInput(raw);
  if (!addr || addr === "ens-unavailable") return { title: "Rare Friends Cards", robots: { index: false, follow: false } };
  const base = baseUrl();
  const name = displayName(raw, addr);
  const title = `${name} · Rare Friends portfolio`;
  const url = `${base}/card/${walletSlug(raw, addr)}`;
  const img = `${url}/og`;
  const alt = `Rare Friends portfolio card for ${name}: inactive, earning, claimable, pending and APR`;
  return {
    title,
    description: TAGLINE,
    alternates: { canonical: url },
    openGraph: { title, description: TAGLINE, url, siteName: "Rare Friends Cards", type: "website", images: [{ url: img, width: 1200, height: 630, type: "image/png", alt }] },
    twitter: { card: "summary_large_image", title, description: TAGLINE, images: [{ url: img, alt }] },
  };
}

export default async function Page({ params }: P) {
  const { address } = await params;
  const raw = decodeParam(address);
  const addr = await resolveInput(raw);
  if (addr === "ens-unavailable") return <Problem title="ENS lookup is down" body="Couldn't reach an Ethereum RPC to resolve that name. Paste the 0x address instead, or try again in a minute." />;
  if (!addr) return <Problem title="Not a wallet address" body={`"${raw}" isn't a 0x address or an ENS name that resolves.`} />;
  const s = await fetchState(addr);
  if (!s) return <Problem title="Rare Friends data unavailable" body="rarefriends.com didn't answer, or its price feed is down. Try again in a minute." />;
  const p = portfolio(s);
  const base = baseUrl();
  const name = displayName(raw, addr);
  const slug = walletSlug(raw, addr);
  const link = `${base}/card/${slug}`;
  // The card is rendered here, from the same snapshot as the strip, and embedded inline: they cannot disagree.
  // The /og route (what scrapers fetch for the link preview) renders its own copy.
  const { png: bytes } = await renderCardPng(<PortfolioCard s={s} name={name} />, PORTFOLIO_W, PORTFOLIO_H);
  const png = `data:image/png;base64,${bytes.toString("base64")}`;
  const fileTag = name === short(addr) ? shortPlain(addr) : name;
  const protoApy = s.metrics?.rewardApy ?? 0;
  // Farm wallets hold hundreds of 1-RF Gen-6 hardwires (seen 2026-09-17). Each hardwired island is a 20 to 65 KB inline
  // SVG that Next also repeats in the RSC payload, so list rows are capped and inline art stops after the first rows.
  const MAX_ROWS = 120, MAX_THUMBS = 40;
  const listed = [...p.earning, ...p.inactive].slice(0, MAX_ROWS);
  const unlisted = p.friends.length - listed.length;

  return (
    <main className="wrap" id="main">
      <header className="pagehead">
        <h1 className="px">PORTFOLIO</h1>
        <div className="chip">[ {name} ]</div>
      </header>

      <section className="strip">
        <div className="cell"><span className="lbl"><i className="dot hollow" />Inactive</span><b>{num(p.inactive.length)}</b></div>
        <div className="cell"><span className="lbl"><i className="dot fill" />Earning</span><b>{num(p.earning.length)}</b></div>
        <div className="cell"><span className="lbl">Claimable</span><b>{usd(p.claimUsd)}</b><small>{num(p.claimRf, 2)} RF + {num(p.claimWeth, 5)} WETH</small></div>
        <div className="cell"><span className="lbl">Pending</span><b>{usd(p.pendingUsd)}</b><small>live estimate weight-based</small></div>
        <div className="cell dark"><span className="lbl">Your APR</span><b>{p.apy != null ? apyPct(p.apy) : "—"}</b><small>{p.apy != null ? "current active stream ÷ RF you paid to activate · annualized" : `no RF paid to activate · protocol APR ${protoApy > 0 ? pct(protoApy, 0) : "—"}`}</small></div>
      </section>

      <section className="cardblock">
        <div className="cardhead">
          <h2 className="px">ALL FRIENDS</h2>
          <span className="muted">one card · {num(p.friends.length)} {p.friends.length === 1 ? "friend" : "friends"}</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="card" src={png} alt={`Portfolio card for ${name}`} width={1200} height={630} />
        <div className="actions">
          <CopyLink url={link} />
          <DownloadCard filename={`rarefriends-portfolio-${fileTag}.png`} />
        </div>
      </section>

      <section className="cardblock">
        <div className="cardhead">
          <h2 className="px">EACH FRIEND</h2>
          <span className="muted">tap one for its own card</span>
        </div>
        {p.friends.length === 0 ? (
          <div className="empty">no Rare Friends in this wallet yet</div>
        ) : (
          <ul className="friends">
            {listed.map((f, i) => (
              <li key={`${f.collection}-${f.id}`}>
                <Link href={`/card/${slug}/${friendSlug(s, f)}`} className="friendrow">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {i < MAX_THUMBS && safeImage(f.imageUrl) ? <img src={safeImage(f.imageUrl)} alt="" width={64} height={64} className="thumb" /> : <span className="thumb" />}
                  <span className="fmeta">
                    <b>{friendLabel(f)} <span className="muted">#{f.id}</span></b>
                    <small>{friendStatus(f)} · weight {num(friendWeight(f), 6)}{f.collection !== "Genesis" && !isTemp(f) ? ` · tier ${f.tier} / 4` : ""}</small>
                  </span>
                  <span className="fval"><b>{usd(claimableUsd(s, f))}</b><small>to claim</small></span>
                  <span className="arrow" aria-hidden>→</span>
                </Link>
              </li>
            ))}
            {unlisted > 0 ? <li className="friendrow muted"><span className="thumb" /><span className="fmeta"><b>+{num(unlisted)} more</b><small>earning Friends are listed first · open a Friend by its id: /card/{slug}/&lt;id&gt;</small></span></li> : null}
          </ul>
        )}
      </section>

      {s.cached ? (
        <p className="foot notice" role="status">rarefriends.com is not answering right now. This is our last good copy, from block {s.blockNumber}{s.ageSeconds != null ? `, about ${Math.max(1, Math.round(s.ageSeconds / 60))} min ago` : ""}.</p>
      ) : null}
      <p className="foot muted">
        {s.cached ? "Cached copy from" : "Numbers read live from"} rarefriends.com · block {s.blockNumber}. Not affiliated with Rare Friends. <Link href="/">make another</Link>
      </p>
    </main>
  );
}
