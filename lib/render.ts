import { ImageResponse } from "next/og";
import { cardFonts, type FontSource } from "./fonts";
import type { ReactElement } from "react";

/** Render a card to PNG bytes. Pages embed this directly so the strip and the card are one snapshot. */
export async function renderCardPng(el: ReactElement, width: number, height: number): Promise<{ png: Buffer; source: FontSource }> {
  const { fonts, source } = await cardFonts();
  const img = new ImageResponse(el, { width, height, fonts });
  return { png: Buffer.from(await img.arrayBuffer()), source };
}

/** The scraper-facing PNG response for the /og routes. */
export async function renderCard(el: ReactElement, width: number, height: number) {
  const { png, source } = await renderCardPng(el, width, height);
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      // Link previews: the CDN keeps a copy for 2 minutes and may serve it 1 more minute while refreshing.
      "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=60",
      "X-Card-Fonts": source,
    },
  });
}
