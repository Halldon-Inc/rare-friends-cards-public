import { decodeParam, resolveInput, fetchState, displayName } from "@/lib/rarefriends";
import { renderCard } from "@/lib/render";
import { PortfolioCard, PORTFOLIO_W, PORTFOLIO_H } from "@/components/cards/PortfolioCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const raw = decodeParam(address);
  const addr = await resolveInput(raw);
  if (addr === "ens-unavailable") return new Response("ENS lookup unavailable, try again shortly", { status: 503, headers: NO_STORE });
  if (!addr) return new Response("Not a wallet address or ENS name", { status: 404, headers: NO_STORE });
  const s = await fetchState(addr);
  if (!s) return new Response("Rare Friends data unavailable", { status: 502, headers: NO_STORE });
  return renderCard(<PortfolioCard s={s} name={displayName(raw, addr)} />, PORTFOLIO_W, PORTFOLIO_H);
}
