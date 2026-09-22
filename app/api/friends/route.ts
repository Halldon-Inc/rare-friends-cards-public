import { decodeParam, resolveInput, fetchState, friendLabel, friendTitle, isEarning, safeImage, displayName } from "@/lib/rarefriends";

// The meme maker's "use one of your Rare Friends" picker: ids, labels and on-chain art for a wallet. Same upstream
// read as the cards, same freshness rules. Capped so a farm wallet with hundreds of Gen-6s stays a reasonable payload.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const MAX = 80;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request) {
  const raw = decodeParam(new URL(req.url).searchParams.get("address") ?? "");
  const addr = await resolveInput(raw);
  if (addr === "ens-unavailable") return json({ error: "ENS lookup is down right now. Paste the 0x address instead." }, 503);
  if (!addr) return json({ error: "That isn't a 0x address or an ENS name that resolves." }, 404);
  const s = await fetchState(addr);
  if (!s) return json({ error: "rarefriends.com didn't answer. Try again in a minute." }, 502);
  const sorted = [...s.friends].sort((a, b) => Number(isEarning(b)) - Number(isEarning(a)));
  const friends = sorted.slice(0, MAX).map((f) => ({ id: f.id, label: friendLabel(f), title: friendTitle(f), imageUrl: safeImage(f.imageUrl), earning: isEarning(f) }));
  return json({ name: displayName(raw, addr), total: s.friends.length, friends });
}
