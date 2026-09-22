import type { ReactNode } from "react";
import { Box, Brand, Label, Value, Portrait, MONO, PX, ACCENT } from "./ui";
import { portfolio, short, safeImage, isEarning, friendLabel, blockStamp, type State, type Friend } from "@/lib/rarefriends";
import { usd, num, pct, apyPct, eth, compact } from "@/lib/format";

export const PORTFOLIO_W = 1200;
export const PORTFOLIO_H = 630;
const MAX_TILES = 8;

// ---- friends-band width budget ------------------------------------------------------------------
// Satori cannot measure text, so the band is PLANNED from estimated glyph advances rather than left to
// flexbox. A tile's width is set by its LABEL ("Gen-4 #87895"), not by the 84px portrait, so as
// Generations ids grew to five digits eight tiles stopped fitting: the row pushed the summary column
// past the right edge and "8 FRIENDS" rendered as "8 FRIEND". Six-digit ids are coming, so the count
// is derived from the actual strings instead of a constant that silently goes stale.
const MONO_EM = 0.6, PX_EM = 0.62; // Sometype Mono and Silkscreen advances, verified against renders
const monoW = (s: string, size: number) => s.length * size * MONO_EM;
const pxW = (s: string, size: number) => s.length * size * PX_EM;

const BAND_INNER = PORTFOLIO_W - 36 * 2 - 22 * 2; // card padding, then band padding
const BAND_GAP = 20, TILE_GAP = 12, TILE_MIN = 84, MORE_W = 84;

/** A tile is as wide as its art or its label plus the 7px status dot and its 5px gap, whichever is bigger. */
const tileWidth = (f: Friend) => Math.max(TILE_MIN, Math.ceil(monoW(`${friendLabel(f)} #${f.id}`, 13)) + 12);

/** Fit as many tiles as the row can really hold; everything left over goes behind the "+N more" tile. */
function planTiles(friends: Friend[], avail: number) {
  const w = friends.map(tileWidth);
  const all = w.reduce((a, x, i) => a + x + (i ? TILE_GAP : 0), 0);
  if (friends.length <= MAX_TILES && all <= avail) return { tiles: friends, extra: 0 };
  const budget = avail - (MORE_W + TILE_GAP); // the "+N more" tile has to fit too
  let used = 0, n = 0;
  while (n < w.length && n < MAX_TILES - 1 && used + w[n] + (n ? TILE_GAP : 0) <= budget) { used += w[n] + (n ? TILE_GAP : 0); n++; }
  return { tiles: friends.slice(0, n), extra: friends.length - n };
}

/** Shrink a value's font so long strings ("$123,456.78", "10,057.32%") stay inside their cell (mono glyph ≈ 0.6 em). */
const fit = (str: string, base: number, maxChars: number) => (str.length > maxChars ? Math.floor((base * maxChars) / str.length) : base);

export function PortfolioCard({ s, name }: { s: State; name?: string }) {
  const p = portfolio(s);
  // The summary column is measured first and never shrinks; the tile row gets whatever is left.
  const summaryW = Math.ceil(Math.max(
    pxW(`${num(p.friends.length)} ${p.friends.length === 1 ? "FRIEND" : "FRIENDS"}`, 28),
    monoW(`${num(p.genesis)} Genesis · ${num(p.generations)} Generations`, 14),
    monoW(`Friend wallets ${usd(p.walletUsd)}`, 14),
  ));
  const { tiles, extra } = planTiles(p.friends, BAND_INNER - BAND_GAP - summaryW);
  // Your APR is null only when nothing was paid to activate; the site shows a dash there, so do we, with the
  // protocol-wide rate in the small print for context (that is the figure on rarefriends.com's home page).
  const protoApy = s.metrics?.rewardApy ?? 0;
  const apyText = p.apy != null ? apyPct(p.apy) : "—";
  const apySub = p.apy != null ? "current active stream ÷ RF you paid to activate" : `no RF paid to activate · protocol APR ${protoApy > 0 ? pct(protoApy, 0) : "—"}`;
  const claim = usd(p.claimUsd);
  const pending = usd(p.pendingUsd);

  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: PORTFOLIO_W, height: PORTFOLIO_H, background: "#fff", border: "6px solid #000", padding: "30px 36px", fontFamily: MONO, color: "#000", gap: 18 }}>
      <Box style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <Box style={{ flexDirection: "column", gap: 8 }}>
          <Brand />
          <div style={{ display: "flex", fontFamily: PX, fontSize: 44, letterSpacing: 2, lineHeight: 1 }}>PORTFOLIO</div>
        </Box>
        <div style={{ display: "flex", fontSize: 17, fontWeight: 700, border: "2px solid #000", padding: "8px 14px" }}>[ {name ?? short(s.address)} ]</div>
      </Box>

      <Box style={{ border: "2px solid #000" }}>
        <Cell w={140} label="Inactive" dot="hollow"><Value size={40}>{num(p.inactive.length)}</Value></Cell>
        <Cell w={140} label="Earning" dot="fill"><Value size={40}>{num(p.earning.length)}</Value></Cell>
        <Cell flex label="Claimable" sub={`${num(p.claimRf, 2)} RF + ${num(p.claimWeth, 5)} WETH`}><Value size={fit(claim, 40, 10)}>{claim}</Value></Cell>
        <Cell flex label="Pending" sub="live estimate weight-based"><Value size={fit(pending, 40, 10)}>{pending}</Value></Cell>
        <Cell w={270} label="Your APR" sub={apySub} dark last><Value size={fit(apyText, 40, 9)} color="#fff">{apyText}</Value></Cell>
      </Box>

      {/* friends band */}
      <Box style={{ background: "#000", color: "#fff", padding: "18px 22px", justifyContent: "space-between", alignItems: "center", gap: BAND_GAP }}>
        <Box style={{ gap: TILE_GAP, alignItems: "center", minHeight: 84, minWidth: 0, overflow: "hidden" }}>
          {tiles.length === 0 ? <Label dim="rgba(255,255,255,.7)" size={14}>no Rare Friends in this wallet yet</Label> : null}
          {tiles.map((f) => (
            <Box key={`${f.collection}-${f.id}`} style={{ flexDirection: "column", alignItems: "center", gap: 6 }}>
              <Portrait src={safeImage(f.imageUrl)} size={84} />
              <Box style={{ alignItems: "center", gap: 5, fontSize: 13 }}>
                <div style={{ display: "flex", width: 7, height: 7, border: "1px solid #fff", background: isEarning(f) ? ACCENT : "transparent" }} />
                <div style={{ display: "flex" }}>{`${friendLabel(f)} #${f.id}`}</div>
              </Box>
            </Box>
          ))}
          {extra > 0 ? (
            <Box style={{ flexDirection: "column", alignItems: "center", gap: 6 }}>
              <Box style={{ width: 84, height: 84, border: "2px dashed #fff", alignItems: "center", justifyContent: "center", fontFamily: PX, fontSize: 22 }}>+{extra}</Box>
              <div style={{ display: "flex", fontSize: 13 }}>more</div>
            </Box>
          ) : null}
        </Box>
        <Box style={{ flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <div style={{ display: "flex", fontFamily: PX, fontSize: 28, lineHeight: 1 }}>{num(p.friends.length)} {p.friends.length === 1 ? "FRIEND" : "FRIENDS"}</div>
          <Label dim="rgba(255,255,255,.7)" size={14}>{num(p.genesis)} Genesis · {num(p.generations)} Generations</Label>
          <Label dim="rgba(255,255,255,.7)" size={14}>Friend wallets {usd(p.walletUsd)}</Label>
        </Box>
      </Box>

      <Box style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Box style={{ gap: 24 }}>
          <Foot label="rewards to pay" value={usd(s.metrics?.streamRemainingUsd ?? 0, 0)} />
          <Foot label="this week's budget" value={`${compact(p.rfBudget)} RF · ${eth(p.wethBudget)} WETH`} />
          <Foot label="claimed to date" value={usd(p.claimedUsd)} />
        </Box>
        <div style={{ display: "flex", fontSize: 13 }}>{blockStamp(s)}</div>
      </Box>
    </div>
  );
}

/** Three fixed slots (label 16, value 40, sub 28) so every value in the strip sits on one baseline. */
function Cell({ children, label, sub, w, flex, dot, dark, last }: { children: ReactNode; label: string; sub?: string; w?: number; flex?: boolean; dot?: "hollow" | "fill"; dark?: boolean; last?: boolean }) {
  const dim = dark ? "rgba(255,255,255,.7)" : "#555";
  return (
    <Box style={{ width: w, flex: flex ? 1 : undefined, flexDirection: "column", gap: 12, padding: "16px 18px", borderRight: last ? undefined : "2px solid #000", background: dark ? "#000" : "#fff", color: dark ? "#fff" : "#000" }}>
      <Box style={{ alignItems: "center", gap: 8, height: 16 }}>
        {dot ? <div style={{ display: "flex", width: 9, height: 9, border: "2px solid #000", background: dot === "fill" ? ACCENT : "transparent" }} /> : null}
        <Label dim={dim}>{label}</Label>
      </Box>
      <Box style={{ height: 40, alignItems: "flex-end" }}>{children}</Box>
      <Box style={{ height: 28, alignItems: "flex-start" }}>{sub ? <Label dim={dim} size={11}>{sub}</Label> : null}</Box>
    </Box>
  );
}

function Foot({ label, value }: { label: string; value: string }) {
  return (
    <Box style={{ flexDirection: "column", gap: 2 }}>
      <Label size={11}>{label}</Label>
      <div style={{ display: "flex", fontSize: 16, fontWeight: 700 }}>{value}</div>
    </Box>
  );
}
