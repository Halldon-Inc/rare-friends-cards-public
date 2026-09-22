import { ImageResponse } from "next/og";
import { cardFonts } from "@/lib/fonts";
import { Box, Logo, MONO, PX, ACCENT } from "@/components/cards/ui";

// The home page's share image: what unfurls when someone posts the bare site URL. Static, built once.
export const runtime = "nodejs";
export const dynamic = "force-static";
export const alt = "Rare Friends Cards: shareable stat cards for Rare Friends holders";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const Chip = ({ children }: { children: string }) => (
  <div style={{ display: "flex", fontFamily: MONO, fontSize: 22, fontWeight: 700, border: "2px solid #000", padding: "12px 20px" }}>{children}</div>
);

export default async function Image() {
  const { fonts } = await cardFonts();
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: size.width, height: size.height, background: "#fff", border: "6px solid #000", padding: "40px 48px", color: "#000", fontFamily: MONO }}>
        <Box style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Box style={{ alignItems: "center", gap: 14 }}>
            <Logo size={30} />
            <div style={{ display: "flex", fontFamily: PX, fontSize: 19, letterSpacing: 2 }}>RARE FRIENDS</div>
          </Box>
          <Box style={{ alignItems: "center", gap: 10, fontSize: 16, border: "2px solid #000", padding: "8px 14px" }}>
            <div style={{ display: "flex", width: 10, height: 10, border: "2px solid #000", background: ACCENT }} />
            <div style={{ display: "flex" }}>read-only · no wallet connect</div>
          </Box>
        </Box>

        <Box style={{ flexDirection: "column", gap: 26 }}>
          <div style={{ display: "flex", fontFamily: PX, fontSize: 92, lineHeight: 0.95, letterSpacing: 2 }}>RARE FRIENDS CARDS</div>
          <div style={{ display: "flex", fontSize: 26, color: "#555" }}>Friends have wallets. Wallets have Friends. Friends collect crypto.</div>
          <Box style={{ gap: 12 }}>
            <Chip>[ portfolio card ]</Chip>
            <Chip>[ one card per Friend ]</Chip>
            <Chip>[ live numbers · block-stamped ]</Chip>
          </Box>
        </Box>

        <Box style={{ background: "#000", color: "#fff", padding: "18px 24px", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 22 }}>paste a wallet or ENS name → get a card to post</div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 700 }}>rare-friends-cards.vercel.app</div>
        </Box>
      </div>
    ),
    { ...size, fonts }
  );
}
