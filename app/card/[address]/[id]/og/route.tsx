import { decodeParam, resolveInput, fetchState, findFriend, displayName } from "@/lib/rarefriends";
import { renderCard } from "@/lib/render";
import { FriendCard, FRIEND_W, FRIEND_H } from "@/components/cards/FriendCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_: Request, { params }: { params: Promise<{ address: string; id: string }> }) {
  const { address, id } = await params;
  const raw = decodeParam(address);
  const addr = await resolveInput(raw);
  if (addr === "ens-unavailable") return new Response("ENS lookup unavailable, try again shortly", { status: 503, headers: NO_STORE });
  if (!addr) return new Response("Not a wallet address or ENS name", { status: 404, headers: NO_STORE });
  const s = await fetchState(addr);
  if (!s) return new Response("Rare Friends data unavailable", { status: 502, headers: NO_STORE });
  const f = findFriend(s, id);
  if (!f) return new Response("That Friend is not in this wallet", { status: 404, headers: NO_STORE });
  return renderCard(<FriendCard s={s} f={f} name={displayName(raw, addr)} />, FRIEND_W, FRIEND_H);
}
