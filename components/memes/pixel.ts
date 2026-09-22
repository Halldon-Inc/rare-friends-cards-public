// Canvas drawing helpers for the meme pack: pixel sprites, pixel and Impact text, PFP placement. Browser only.

export type Ctx = CanvasRenderingContext2D;
export const W = 1080;
export const H = 1080;
export const LIME = "#ccff00";
export const BLACK = "#000";
export const WHITE = "#fff";
export const GREY = "#ebebeb";
export const DIM = "#555";
export const RED = "#ff3b30";
export const ORANGE = "#ff8a00";
export const YELLOW = "#ffd400";
export const SKY = "#8fd3ff";
export const PINK = "#ff5fa2";

export type Fonts = { px: string; impact: string };

/** Draw a sprite from rows of characters; palette maps a character to a colour, anything else is transparent. */
export function sprite(ctx: Ctx, rows: string[], palette: Record<string, string>, x: number, y: number, s: number) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const col = palette[row[c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x + c * s), Math.round(y + r * s), Math.ceil(s), Math.ceil(s));
    }
  }
}

export const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** A hard-edged pixel frame: outer border of `t` px. */
export function frame(ctx: Ctx, x: number, y: number, w: number, h: number, t: number, color: string) {
  rect(ctx, x, y, w, t, color);
  rect(ctx, x, y + h - t, w, t, color);
  rect(ctx, x, y, t, h, color);
  rect(ctx, x + w - t, y, t, h, color);
}

/** Pixel font text (Silkscreen). */
export function pxText(ctx: Ctx, text: string, x: number, y: number, size: number, color: string, fonts: Fonts, align: CanvasTextAlign = "left", spacing = 0) {
  ctx.save();
  ctx.font = `${size}px ${fonts.px}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
  } catch {}
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function measurePx(ctx: Ctx, text: string, size: number, fonts: Fonts) {
  ctx.save();
  ctx.font = `${size}px ${fonts.px}`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

/** Word-wrap for the current ctx.font. */
export function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Classic meme caption: Impact, white fill, black stroke, uppercase, wrapped. `anchor` is top or bottom edge. */
export function impactText(ctx: Ctx, text: string, cx: number, edgeY: number, size: number, maxWidth: number, fonts: Fonts, anchor: "top" | "bottom" = "top") {
  if (!text.trim()) return;
  ctx.save();
  ctx.font = `bold ${size}px ${fonts.impact}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, size / 9);
  ctx.strokeStyle = BLACK;
  ctx.fillStyle = WHITE;
  const lines = wrap(ctx, text.toUpperCase(), maxWidth);
  const lh = size * 1.08;
  const startY = anchor === "top" ? edgeY : edgeY - lines.length * lh;
  lines.forEach((l, i) => {
    ctx.strokeText(l, cx, startY + i * lh);
    ctx.fillText(l, cx, startY + i * lh);
  });
  ctx.restore();
}

/** Pixel text, wrapped and centred on cx, growing downward from y. Returns the height used. */
export function pxParagraph(ctx: Ctx, text: string, cx: number, y: number, size: number, maxWidth: number, color: string, fonts: Fonts, lineGap = 1.35) {
  ctx.save();
  ctx.font = `${size}px ${fonts.px}`;
  const lines = wrap(ctx, text, maxWidth);
  ctx.restore();
  lines.forEach((l, i) => pxText(ctx, l, cx, y + size + i * size * lineGap, size, color, fonts, "center"));
  return lines.length * size * lineGap;
}

/**
 * Draw the PFP centre-cropped to a square. `pixelate` resamples through a tiny offscreen canvas for the 8-bit look.
 * Rare Friends art is transparent SVG; `bg` paints behind it so it never floats on nothing.
 */
export function drawPfp(ctx: Ctx, img: CanvasImageSource, x: number, y: number, size: number, opts: { pixelate?: boolean; bg?: string; px?: number; transparent?: boolean } = {}) {
  const iw = "naturalWidth" in img ? (img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width : (img as ImageBitmap).width;
  const ih = "naturalHeight" in img ? (img as HTMLImageElement).naturalHeight || (img as HTMLImageElement).height : (img as ImageBitmap).height;
  const side = Math.min(iw, ih);
  const sx = (iw - side) / 2;
  const sy = (ih - side) / 2;
  if (opts.bg && !opts.transparent) rect(ctx, x, y, size, size, opts.bg);
  ctx.save();
  if (opts.pixelate) {
    const n = opts.px ?? 48;
    const off = document.createElement("canvas");
    off.width = n;
    off.height = n;
    const o = off.getContext("2d")!;
    o.imageSmoothingEnabled = true;
    o.drawImage(img, sx, sy, side, side, 0, 0, n, n);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, n, n, x, y, size, size);
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, x, y, size, size);
  }
  ctx.restore();
}

/** Circle-cropped PFP (for sticker looks). */
export function drawPfpRound(ctx: Ctx, img: CanvasImageSource, cx: number, cy: number, r: number, opts: { pixelate?: boolean; bg?: string } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawPfp(ctx, img, cx - r, cy - r, r * 2, opts);
  ctx.restore();
}

/** Stripes background (sunrise, holo). */
export function stripes(ctx: Ctx, colors: string[], y0: number, y1: number, band: number) {
  let i = 0;
  for (let y = y0; y < y1; y += band) rect(ctx, 0, y, W, band, colors[i++ % colors.length]);
}

/** Scatter little squares (confetti, stars). Deterministic from a seed so re-renders do not jitter. */
export function confetti(ctx: Ctx, count: number, colors: string[], seed: number, minS = 6, maxS = 16, area: [number, number, number, number] = [0, 0, W, H]) {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < count; i++) {
    const size = minS + rnd() * (maxS - minS);
    rect(ctx, area[0] + rnd() * area[2], area[1] + rnd() * area[3], size, size, colors[Math.floor(rnd() * colors.length)]);
  }
}

// ----- sprites (character maps) -----

export const HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
export const COIN = ["00111100", "01111110", "11011011", "11011011", "11011011", "11011011", "01111110", "00111100"];
export const DIAMOND = ["00111100", "01111110", "11111111", "01111110", "00111100", "00011000"];
export const FLAME = ["00001000", "00011000", "00111100", "01111100", "01111110", "11111110", "11111111", "01111110"];
export const CUP = ["0111111100", "0111111110", "0111111111", "0111111111", "0111111110", "0011111100", "0001111000", "1111111111"];
export const SHADES = ["11111110111111", "11111110111111", "01111100111110", "00111000011100"];
export const HAND = ["0000011000", "0000011000", "0000011000", "0011111110", "0111111111", "0111111111", "0111111111", "0011111110", "0001111100"];
export const STAR = ["00100", "01110", "11111", "01110", "00100"];
export const ARROW_UP = ["0001000", "0011100", "0111110", "1111111", "0011100", "0011100", "0011100"];
export const SKULL = ["0011110", "0111111", "1101011", "1111111", "0111110", "0101010"];
export const BRAIN = ["00111111100", "01111011110", "11101011011", "11110111111", "11101011011", "01111011110", "00111111100", "00001110000"];
/** A pointing hand, index finger to the right. Mirror it with a negative scale for the other side. */
export const POINT = ["000000000011100", "000000000001110", "111111111111111", "111111111111111", "000000000001110", "000000000011100"];
export const BOLT = ["00011", "00110", "01100", "11111", "00110", "01100", "11000"];
export const CROWN = ["1000101", "1101111", "1111111", "1111111", "0111110"];
export const EGG_SHELL = ["0000111100", "0011111111", "0111111111", "1111111111", "1111111111", "1111111111", "0111111111", "0011111110", "0000111100"];
export const SWEAT = ["00100", "00100", "01110", "01110", "11111", "11111", "01110"];
export const CHECK = ["000000011", "000000110", "000001100", "100011000", "110110000", "011100000", "001000000"];
export const CROSS = ["1100011", "1110111", "0111110", "0011100", "0111110", "1110111", "1100011"];
export const GUN = ["111111111100", "111111111111", "000111000011", "000111000000", "000111000000", "001110000000"];
export const BUTTERFLY = ["11000000011", "11100000111", "11110101111", "01111111110", "01111111110", "11110101111", "11100000111", "11000000011"];
export const MUSCLE = ["0011110000", "0111111000", "1111111100", "1111111110", "0111111111", "0011111111", "0000111111", "0000001111"];
export const EXCLAIM = ["11", "11", "11", "11", "11", "00", "11"];
export const TIE = ["1111", "0110", "0110", "1111", "1111", "1111", "1111", "0110"];
export const PERSON = ["001100", "011110", "011110", "001100", "111111", "111111", "011110", "011110", "011110", "110011", "110011"];
/** The site's 8x8 mark, used as the placeholder Friend before a PFP is dropped in. */
export const MARK = ["11111111", "10011001", "11001100", "10100101", "10000001", "10011001", "11000011", "11111111"];

export const mono = (c: string) => ({ "1": c });
