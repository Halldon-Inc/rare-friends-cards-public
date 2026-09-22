import { Box, Brand, Label, Value, Status, Portrait, MONO, PX } from "./ui";
import { claimableUsd, nextRewardUsd, friendShare, friendWeight, isEarning, friendLabel, friendTierLabel, friendTitle, totalWeight, walletBalances, short, safeImage, genesisApyPercent, blockStamp, GENESIS_WEIGHT, type State, type Friend } from "@/lib/rarefriends";
import { usd, num, pct, apyPct, sharePct, compact, eth } from "@/lib/format";

export const FRIEND_W = 1200;
export const FRIEND_H = 630;

export { friendTitle };

const fit = (str: string, base: number, maxChars: number) => (str.length > maxChars ? Math.floor((base * maxChars) / str.length) : base);

export function FriendCard({ s, f, name }: { s: State; f: Friend; name?: string }) {
  const share = friendShare(s, f);
  const claim = usd(claimableUsd(s, f));
  const next = usd(nextRewardUsd(s, f));
  const w = walletBalances(f);
  const isGenesis = f.collection === "Genesis";
  const earning = isEarning(f);
  // Genesis: the site's own holder formula applied to one activated Genesis (2,000,000 weight, 100,000 RF paid), i.e.
  // what THIS Friend earns. Generations: activation cost is not in the API, so show the protocol-wide rate, labelled.
  const genesisApy = genesisApyPercent(s);
  const protoApy = s.metrics?.rewardApy ?? 0;
  const apyLabel = isGenesis ? "Genesis APR" : "protocol APR";
  const apyValue = isGenesis ? genesisApy : protoApy > 0 ? protoApy : null;
  const apyText = apyValue != null ? apyPct(apyValue) : "—";
  const apySub = isGenesis
    ? earning
      ? "current active stream ÷ 100,000 RF to activate · annualized"
      : "once activated · current active stream ÷ 100,000 RF · annualized"
    : "protocol-wide · your own APR is on the portfolio card";
  const rfBudget = s.streams?.find((x) => x.asset === "RF")?.budget ?? 0;
  const wethBudget = s.streams?.find((x) => x.asset === "WETH")?.budget ?? 0;

  return (
    <div style={{ display: "flex", width: FRIEND_W, height: FRIEND_H, background: "#fff", border: "6px solid #000", fontFamily: MONO, color: "#000" }}>
      {/* portrait panel */}
      <Box style={{ width: 420, flexDirection: "column", justifyContent: "space-between", background: "#000", color: "#fff", padding: "32px 36px", borderRight: "6px solid #000" }}>
        <Box style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: PX, fontSize: 15, letterSpacing: 3 }}>{friendLabel(f).toUpperCase()}</div>
          <Label dim="rgba(255,255,255,.7)" size={12}>{friendTierLabel(f)}</Label>
        </Box>
        <Box style={{ justifyContent: "center" }}>
          {/* Generations islands are drawn small inside their square; give them the panel's full content width (420 - padding - border). */}
          <Portrait src={safeImage(f.imageUrl)} size={isGenesis ? 280 : 340} />
        </Box>
        <Box style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontFamily: PX, fontSize: f.id.toString().length > 4 ? 40 : 56, lineHeight: 1 }}>#{f.id}</div>
          <Box style={{ flexDirection: "column", alignItems: "flex-end", fontSize: 14, color: "rgba(255,255,255,.7)" }}>
            <div style={{ display: "flex" }}>owner</div>
            <div style={{ display: "flex" }}>{name ?? short(s.address)}</div>
          </Box>
        </Box>
      </Box>

      {/* stats */}
      <Box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "space-between", padding: "26px 32px", gap: 14 }}>
        <Box style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Brand />
          <Status earning={earning} />
        </Box>

        <Box style={{ border: "2px solid #000" }}>
          <Box style={{ flex: 1, flexDirection: "column", gap: 6, padding: "14px 18px", borderRight: "2px solid #000" }}>
            <Label>rewards to claim</Label>
            <Value size={fit(claim, 38, 11)}>{claim}</Value>
            <Label size={12}>{num(f.earnings ?? 0, 3)} RF + {num(f.earningsWeth ?? 0, 6)} WETH</Label>
          </Box>
          <Box style={{ flex: 1, flexDirection: "column", gap: 6, padding: "14px 18px" }}>
            <Label>pending</Label>
            <Value size={fit(next, 38, 11)}>{next}</Value>
            <Label size={12}>live estimate weight-based</Label>
          </Box>
        </Box>

        <Box style={{ border: "2px solid #000" }}>
          <Box style={{ width: 290, flexDirection: "column", justifyContent: "space-between", gap: 6, padding: "14px 18px", background: "#000", color: "#fff" }}>
            <Label dim="rgba(255,255,255,.7)">{apyLabel}</Label>
            <Value size={fit(apyText, 42, 9)} color="#fff">{apyText}</Value>
            <Label dim="rgba(255,255,255,.7)" size={11}>{apySub}</Label>
          </Box>
          <Box style={{ flex: 1, flexDirection: "column" }}>
            <Row label="reward weight" value={num(friendWeight(f), 6)} sub={!earning && isGenesis ? "→ 2,000,000 on activate" : undefined} border />
            <Row
              label="share of active weight"
              value={sharePct(share * 100)}
              sub={!earning && isGenesis ? `→ ${pct((GENESIS_WEIGHT / (totalWeight(s) + GENESIS_WEIGHT)) * 100, 2)} on activate` : `of ${compact(totalWeight(s))}`}
              border
            />
            {w.exists ? (
              <Row label="NFT wallet" value={`${num(w.rf, 3)} RF`} sub={`· ${num(w.weth, 6)} WETH`} />
            ) : (
              <Row label="NFT wallet" value="none yet" sub="· hardwire required" />
            )}
          </Box>
        </Box>

        <Box style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Box style={{ gap: 24 }}>
            <Stat label="rewards to pay" value={usd(s.metrics?.streamRemainingUsd ?? 0, 0)} />
            <Stat label="this week's budget" value={`${compact(rfBudget)} RF · ${eth(wethBudget)} WETH`} />
            {/* Generations already carry "GEN-N" and "tier N / 4" in the panel header; the footer must stay under 700 px. */}
            {isGenesis ? <Stat label="activation" value="100,000 RF" /> : null}
          </Box>
          <div style={{ display: "flex", fontSize: 13 }}>{blockStamp(s)}</div>
        </Box>
      </Box>
    </div>
  );
}

function Row({ label, value, sub, border }: { label: string; value: string; sub?: string; border?: boolean }) {
  return (
    <Box style={{ justifyContent: "space-between", alignItems: "center", padding: "11px 18px", borderBottom: border ? "2px solid #000" : undefined, flex: 1 }}>
      <Label>{label}</Label>
      <Box style={{ alignItems: "baseline", gap: 8 }}>
        <div style={{ display: "flex", fontSize: 20, fontWeight: 700 }}>{value}</div>
        {sub ? <Label size={12}>{sub}</Label> : null}
      </Box>
    </Box>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box style={{ flexDirection: "column", gap: 2 }}>
      <Label size={11}>{label}</Label>
      <div style={{ display: "flex", fontSize: 16, fontWeight: 700 }}>{value}</div>
    </Box>
  );
}
