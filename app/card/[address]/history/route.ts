import { decodeParam, resolveInput } from "@/lib/rarefriends";
import { readActivationPaidNow } from "@/lib/upstream";

// A cold wallet's activation history can take longer than a card page may wait. The page renders without it and the
// browser calls this, which reads it with room to spare; the history's chunks land in the shared caches on the way.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const HEADERS = { "Cache-Control": "no-store" };

export async function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const addr = await resolveInput(decodeParam(address));
  if (!addr || addr === "ens-unavailable") return Response.json({ known: false }, { status: 404, headers: HEADERS });
  const paid = await readActivationPaidNow(addr, 40_000).catch(() => null);
  return Response.json({ known: paid != null }, { headers: HEADERS });
}
