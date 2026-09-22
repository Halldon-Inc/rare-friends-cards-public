import { readFile } from "node:fs/promises";
import path from "node:path";

// Satori needs TTF / OTF / WOFF (not WOFF2). The three fonts are bundled in assets/fonts (OFL, see LICENSE.txt)
// so rendering never depends on Google Fonts at runtime. Google is only a fallback if a local read fails.
const LOCAL: Record<string, string> = {
  "Silkscreen:400": "silkscreen-400.ttf",
  "Sometype Mono:400": "sometype-mono-400.ttf",
  "Sometype Mono:700": "sometype-mono-700.ttf",
};
// Old Safari UA gets static TTF from Google; old Firefox UA gets WOFF (verified 2026-09-16). Both are accepted.
const UAS = [
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.6; rv:2.0) Gecko/20100101 Firefox/4.0",
];
const SRC = /url\(([^)]+)\)\s*format\('(truetype|opentype|woff)'\)/g;
const cache = new Map<string, Promise<ArrayBuffer>>();

async function loadLocal(key: string): Promise<ArrayBuffer | null> {
  const file = LOCAL[key];
  if (!file) return null;
  try {
    const b = await readFile(path.join(process.cwd(), "assets", "fonts", file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

async function findGoogleUrl(family: string, weight: number): Promise<string> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`;
  let woff: string | null = null;
  for (const ua of UAS) {
    const res = await fetch(cssUrl, { headers: { "User-Agent": ua }, cache: "force-cache" });
    if (!res.ok) continue;
    const css = await res.text();
    for (const m of css.matchAll(SRC)) {
      const url = m[1].replace(/^['"]|['"]$/g, "");
      if (m[2] !== "woff") return url;
      woff ??= url;
    }
  }
  if (woff) return woff;
  throw new Error(`No usable font file for ${family}:${weight}`);
}

async function loadGoogle(family: string, weight: number): Promise<ArrayBuffer> {
  const url = await findGoogleUrl(family, weight);
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Font download failed for ${family}:${weight}: ${res.status}`);
  return res.arrayBuffer();
}

export type FontSource = "local" | "google";
const sources = new Map<string, FontSource>();

export function loadFont(family: string, weight: 400 | 700) {
  const key = `${family}:${weight}`;
  if (!cache.has(key)) {
    const p = (async () => {
      const local = await loadLocal(key);
      sources.set(key, local ? "local" : "google");
      return local ?? loadGoogle(family, weight);
    })();
    // Don't poison the cache with a transient failure.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key)!;
}

export async function cardFonts() {
  const [silk, monoR, monoB] = await Promise.all([
    loadFont("Silkscreen", 400),
    loadFont("Sometype Mono", 400),
    loadFont("Sometype Mono", 700),
  ]);
  const fonts = [
    { name: "Silkscreen", data: silk, weight: 400 as const, style: "normal" as const },
    { name: "Sometype Mono", data: monoR, weight: 400 as const, style: "normal" as const },
    { name: "Sometype Mono", data: monoB, weight: 700 as const, style: "normal" as const },
  ];
  // "local" only if every face came from the bundle; surfaced as the x-card-fonts response header.
  const source: FontSource = [...sources.values()].every((s) => s === "local") ? "local" : "google";
  return { fonts, source };
}
