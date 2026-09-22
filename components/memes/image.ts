// Turning whatever the visitor gives us (a file, a paste, a Rare Friend's on-chain SVG) into a square canvas the
// templates can draw. Browser only. Nothing here leaves the page.
import { MARK, LIME, BLACK, sprite } from "./pixel";

export type Source = { canvas: HTMLCanvasElement; pixelArt: boolean; transparent: boolean; label: string };

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image could not be read."));
    img.src = src;
  });
}

/** An SVG without width/height draws as nothing on a canvas; give it the viewBox size (or 512). */
export async function ensureSvgSize(blob: Blob): Promise<Blob> {
  const text = await blob.text();
  const open = text.match(/<svg[^>]*>/i)?.[0];
  if (!open || (/\swidth=/.test(open) && /\sheight=/.test(open))) return blob;
  const vb = open.match(/viewBox="([^"]+)"/)?.[1]?.split(/[\s,]+/).map(Number);
  const w = vb && vb.length === 4 ? vb[2] : 512;
  const h = vb && vb.length === 4 ? vb[3] : 512;
  const fixed = text.replace(open, open.replace(/<svg/i, `<svg width="${w}" height="${h}"`));
  return new Blob([fixed], { type: "image/svg+xml" });
}

export async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const b = blob.type === "image/svg+xml" ? await ensureSvgSize(blob) : blob;
  const url = URL.createObjectURL(b);
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Square, trimmed, ready to draw. `trim` finds the art's bounding box against the corner colour (Generations islands
 * sit small in a big black square; a Gen-6 is 16% of it) and crops to it with a margin. Tiny sources (the 8x8 Genesis
 * sprite) are upscaled without smoothing and flagged pixelArt so the templates keep their edges hard.
 */
export function prepare(img: HTMLImageElement, opts: { trim: boolean; knockout: boolean; label: string }): Source {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const pixelArt = Math.max(iw, ih) <= 64;
  const work = document.createElement("canvas");
  const base = pixelArt ? 512 : Math.min(1024, Math.max(iw, ih));
  const scale = base / Math.max(iw, ih);
  work.width = Math.max(1, Math.round(iw * scale));
  work.height = Math.max(1, Math.round(ih * scale));
  const w = work.getContext("2d", { willReadFrequently: true })!;
  w.imageSmoothingEnabled = !pixelArt;
  w.drawImage(img, 0, 0, work.width, work.height);

  let x0 = 0, y0 = 0, x1 = work.width, y1 = work.height;
  const data = w.getImageData(0, 0, work.width, work.height);
  const d = data.data;
  if (opts.knockout) {
    // Near-black becomes transparent (the on-chain art's background), so the Friend floats on the template.
    for (let i = 0; i < d.length; i += 4) if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) d[i + 3] = 0;
    w.putImageData(data, 0, 0);
  }
  if (opts.trim) {
    const bg = [d[0], d[1], d[2], d[3]];
    const isBg = (i: number) => d[i + 3] < 16 || (bg[3] > 200 && Math.abs(d[i] - bg[0]) < 28 && Math.abs(d[i + 1] - bg[1]) < 28 && Math.abs(d[i + 2] - bg[2]) < 28);
    let minX = work.width, minY = work.height, maxX = -1, maxY = -1;
    for (let y = 0; y < work.height; y++) for (let x = 0; x < work.width; x++) { const i = (y * work.width + x) * 4; if (!isBg(i)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
    if (maxX > minX && maxY > minY) {
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      // Only crop when the art actually sits inside empty space (islands), not for photos that fill the frame.
      if (bw < work.width * 0.9 || bh < work.height * 0.9) {
        const side = Math.max(bw, bh) * 1.16;
        const cx = minX + bw / 2, cy = minY + bh / 2;
        x0 = cx - side / 2; y0 = cy - side / 2; x1 = cx + side / 2; y1 = cy + side / 2;
      }
    }
  }
  const out = document.createElement("canvas");
  const size = 1024;
  out.width = size;
  out.height = size;
  const o = out.getContext("2d")!;
  const side = Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // Fill the frame's background colour (or transparent) behind a cropped island so edges stay clean.
  if (!opts.knockout && d[3] > 200) { o.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`; o.fillRect(0, 0, size, size); }
  o.imageSmoothingEnabled = !pixelArt;
  o.imageSmoothingQuality = "high";
  o.drawImage(work, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  return { canvas: out, pixelArt, transparent: opts.knockout, label: opts.label };
}

/** The site's mark as a stand-in Friend, so the pack renders before anything is dropped in. */
export function placeholderSource(): Source {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, 512, 512);
  sprite(ctx, MARK, { "1": LIME }, 64, 64, 48);
  return { canvas: c, pixelArt: true, transparent: false, label: "the mark (drop your Friend in)" };
}
