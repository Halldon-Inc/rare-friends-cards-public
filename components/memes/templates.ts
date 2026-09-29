// The meme pack: the real templates everyone recognises, self-hosted in /public/memes, with the visitor's Friend pasted
// onto the face slots and the captions auto-fitted into each template's own text areas. Three code-drawn templates
// (classic, deal with it, holo card) work on any art and stay.
import { W, H, LIME, BLACK, WHITE, YELLOW, sprite, rect, frame, pxText, impactText, drawPfp, stripes, confetti, SHADES, CROWN, mono, type Ctx, type Fonts } from "./pixel";

export type Field = { key: string; label: string; def: string; max?: number };
export type DrawProps = { pfp: CanvasImageSource; text: Record<string, string>; fonts: Fonts; pixelate: boolean; pixelArt: boolean; transparent: boolean; image?: HTMLImageElement };
export type Template = {
  id: string;
  name: string;
  blurb: string;
  /** Canvas size in template units; the renderer scales to the output size. */
  w: number;
  h: number;
  /** Template image under /memes, when the template is a photo. */
  src?: string;
  fields: Field[];
  bank?: string[][];
  draw: (ctx: Ctx, p: DrawProps) => void;
};

type Slot = { x: number; y: number; w: number; h: number; rot?: number };
type Box = { key: string; label: string; def: string; x: number; y: number; w: number; h: number; style: "impact" | "plain"; max?: number; /** aLtErNaTiNg CaPs instead of upper case (mocking SpongeBob). */ mock?: boolean };
type Photo = { id: string; name: string; blurb: string; src: string; w: number; h: number; faces: Slot[]; boxes: Box[]; bank?: string[][]; cover?: { x: number; y: number; w: number; h: number; color: string }[] };

const t = (p: DrawProps, key: string, tpl: Template) => (p.text[key] ?? tpl.fields.find((f) => f.key === key)?.def ?? "");

/** Word-wrap `text` into `maxW` at `size`, returns lines. */
function wrapAt(ctx: Ctx, text: string, size: number, font: string, maxW: number) {
  ctx.font = `bold ${size}px ${font}`;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** aLtErNaTiNg CaPs, letters only, so digits and punctuation pass through. */
const mockCase = (s: string) => { let i = 0; return s.replace(/[a-z]/gi, (c) => (i++ % 2 ? c.toUpperCase() : c.toLowerCase())); };

/** Caption fitted into a box: shrink from a size proportional to the box until the wrapped lines fit, counting the
 * Impact stroke; at the floor size the line is squeezed horizontally instead, so a caption can never clip a word. */
function fitText(ctx: Ctx, text: string, box: Box, fonts: Fonts) {
  const s = text.trim();
  if (!s) return;
  const upper = box.mock ? mockCase(s) : s.toUpperCase();
  const inner = box.w - 8;
  const stroke = (size: number) => (box.style === "impact" ? Math.max(3, size / 9) : 0);
  const MIN = 12;
  let size = Math.min(box.h * 0.6, box.w / 4, 140);
  let lines: string[] = [];
  let widest = 0;
  for (; size >= MIN; size -= 2) {
    lines = wrapAt(ctx, upper, size, fonts.impact, inner - stroke(size));
    widest = Math.max(...lines.map((l) => ctx.measureText(l).width)) + stroke(size);
    if (widest <= inner && lines.length * size * 1.1 <= box.h) break;
  }
  if (size < MIN) {
    size = MIN;
    lines = wrapAt(ctx, upper, size, fonts.impact, inner - stroke(size));
    widest = Math.max(...lines.map((l) => ctx.measureText(l).width)) + stroke(size);
  }
  // a single word wider than the box at the floor size: squeeze the glyphs rather than let them run past the edge
  const squeeze = widest > inner ? inner / widest : 1;
  // more lines than the box holds at the floor size: pack the leading so the block still ends inside the box
  const lh = Math.min(size * 1.1, box.h / lines.length);
  ctx.save();
  ctx.font = `bold ${size}px ${fonts.impact}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  const y0 = box.y + (box.h - lines.length * lh) / 2;
  lines.forEach((l, i) => {
    const x = box.x + box.w / 2, y = y0 + i * lh;
    ctx.save();
    if (squeeze < 1) { ctx.translate(x, 0); ctx.scale(squeeze, 1); ctx.translate(-x, 0); }
    if (box.style === "impact") {
      ctx.lineWidth = stroke(size);
      ctx.strokeStyle = BLACK;
      ctx.strokeText(l, x, y);
      ctx.fillStyle = WHITE;
      ctx.fillText(l, x, y);
    } else {
      ctx.fillStyle = BLACK;
      ctx.fillText(l, x, y);
    }
    ctx.restore();
  });
  ctx.restore();
}

/** The Friend on a face slot: square, white-edged, optionally tilted, with a soft shadow so it sits in the photo. */
function face(ctx: Ctx, p: DrawProps, s: Slot) {
  const size = Math.min(s.w, s.h);
  const x = s.x + (s.w - size) / 2, y = s.y + (s.h - size) / 2;
  ctx.save();
  if (s.rot) { ctx.translate(x + size / 2, y + size / 2); ctx.rotate(s.rot); ctx.translate(-(x + size / 2), -(y + size / 2)); }
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetY = size * 0.04;
  if (p.transparent) {
    // knocked-out art floats straight on the photo; the shadow hugs its outline
    drawPfp(ctx, p.pfp, x, y, size, { pixelate: p.pixelate, transparent: true });
  } else {
    rect(ctx, x, y, size, size, WHITE);
    ctx.shadowColor = "transparent";
    const b = Math.max(2, Math.round(size * 0.03));
    drawPfp(ctx, p.pfp, x + b, y + b, size - 2 * b, { pixelate: p.pixelate, bg: BLACK });
  }
  ctx.restore();
}

function photo(d: Photo): Template {
  const tpl: Template = {
    id: d.id,
    name: d.name,
    blurb: d.blurb,
    w: d.w,
    h: d.h,
    src: `/memes/${d.src}`,
    fields: d.boxes.map((b) => ({ key: b.key, label: b.label, def: b.def, max: b.max ?? 60 })),
    bank: d.bank,
    draw(ctx, p) {
      if (p.image) ctx.drawImage(p.image, 0, 0, d.w, d.h);
      else { rect(ctx, 0, 0, d.w, d.h, "#ddd"); }
      for (const c of d.cover ?? []) rect(ctx, c.x, c.y, c.w, c.h, c.color);
      for (const s of d.faces) face(ctx, p, s);
      for (const b of d.boxes) fitText(ctx, t(p, b.key, tpl), b, p.fonts);
    },
  };
  return tpl;
}

// ---------- the photo pack ----------

const drake = photo({
  id: "drake", name: "Drake", blurb: "nah to the first, yeah to the second", src: "drake.jpg", w: 1200, h: 1200,
  faces: [{ x: 30, y: 30, w: 280, h: 280, rot: -0.12 }, { x: 280, y: 610, w: 270, h: 270, rot: 0.06 }],
  boxes: [
    { key: "no", label: "nah", def: "buying the token", x: 620, y: 40, w: 560, h: 520, style: "plain" },
    { key: "yes", label: "yeah", def: "buying a Friend that buys the token", x: 620, y: 640, w: 560, h: 520, style: "plain" },
  ],
  bank: [["buying the token", "buying a Friend that buys the token"], ["checking the price", "checking the block number"], ["reading the docs", "asking the group chat at 4am"], ["selling the Friend", "withdrawing its wallet, then selling the Friend"], ["7,000% on the home page", "my actual APR on the portfolio page"]],
});

const distracted = photo({
  id: "distracted", name: "Distracted boyfriend", blurb: "three labels, one betrayal", src: "distracted.jpg", w: 1200, h: 800,
  faces: [{ x: 570, y: 70, w: 200, h: 200, rot: 0.1 }],
  boxes: [
    { key: "girl", label: "girl in red", def: "a Gen-6 for 1 RF", x: 140, y: 480, w: 400, h: 130, style: "impact" },
    { key: "boy", label: "boyfriend", def: "me", x: 570, y: 560, w: 330, h: 110, style: "impact" },
    { key: "gf", label: "girlfriend", def: "my hardwired Genesis", x: 880, y: 500, w: 300, h: 130, style: "impact" },
  ],
  bank: [["a Gen-6 for 1 RF", "me", "my hardwired Genesis"], ["the meme machine", "me", "my actual job"], ["checking pending", "me", "sleep"], ["a new temp Friend", "me", "the 37 Friends I already have"]],
});

const buttons = photo({
  id: "buttons", name: "Two buttons", blurb: "sweating over the only two options", src: "buttons.jpg", w: 600, h: 908,
  faces: [{ x: 200, y: 480, w: 220, h: 220, rot: 0.05 }],
  boxes: [
    { key: "a", label: "left button", def: "claim the rewards", x: 45, y: 92, w: 200, h: 84, style: "plain" },
    { key: "b", label: "right button", def: "let the Friend hold them", x: 295, y: 56, w: 215, h: 78, style: "plain" },
    { key: "who", label: "who is sweating", def: "me, every Monday", x: 30, y: 790, w: 540, h: 90, style: "impact" },
  ],
  bank: [["claim the rewards", "let the Friend hold them", "me, every Monday"], ["hardwire one Gen-6", "hardwire 4,000 Gen-6s", "the wallet farmers at 2am"], ["buy the dip", "buy the Friend", "my last 100,000 RF"], ["go to sleep", "check pending one more time", "4:20 am"]],
});

const changemind = photo({
  id: "changemind", name: "Change my mind", blurb: "a table, a sign, a take", src: "changemind.jpg", w: 482, h: 361,
  faces: [{ x: 182, y: 55, w: 90, h: 90, rot: -0.05 }],
  boxes: [{ key: "take", label: "the take", def: "Gen-6 is the best value in crypto", x: 225, y: 232, w: 210, h: 66, style: "plain" }],
  bank: [["Gen-6 is the best value in crypto"], ["your Friend is a better investor than you"], ["APR is a feeling"], ["temp is a lifestyle"], ["the block number is the only truth"]],
});

const brain = photo({
  id: "brain", name: "Expanding brain", blurb: "four rows of ascending enlightenment", src: "brain.jpg", w: 857, h: 1202,
  // on the face of each profile, so the brain stays visible above
  faces: [{ x: 450, y: 120, w: 160, h: 160, rot: 0.05 }, { x: 640, y: 420, w: 160, h: 160, rot: 0.05 }, { x: 640, y: 720, w: 160, h: 160, rot: 0.05 }, { x: 560, y: 1010, w: 160, h: 160, rot: -0.05 }],
  boxes: [
    { key: "r1", label: "row 1", def: "holding the token", x: 20, y: 20, w: 390, h: 260, style: "plain" },
    { key: "r2", label: "row 2", def: "holding a Friend", x: 20, y: 315, w: 390, h: 275, style: "plain" },
    { key: "r3", label: "row 3", def: "hardwiring the Friend", x: 20, y: 625, w: 390, h: 245, style: "plain" },
    { key: "r4", label: "row 4", def: "the Friend holds the token", x: 20, y: 900, w: 390, h: 280, style: "plain" },
  ],
  bank: [["holding the token", "holding a Friend", "hardwiring the Friend", "the Friend holds the token"], ["100% APR", "1,000% APR", "10,000% APR", "APR is a state of mind"], ["checking price", "checking claimable", "checking pending", "checking the block number"], ["buying at the top", "buying the dip", "buying a Friend", "letting the Friend buy"]],
});

const gru = photo({
  id: "gru", name: "Gru's plan", blurb: "four panels, the last two say the same thing", src: "gru.jpg", w: 700, h: 449,
  faces: [{ x: 62, y: 14, w: 92, h: 92, rot: -0.05 }, { x: 412, y: 30, w: 92, h: 92, rot: 0.05 }, { x: 60, y: 254, w: 92, h: 92, rot: -0.08 }, { x: 420, y: 250, w: 92, h: 92, rot: 0.1 }],
  boxes: [
    { key: "s1", label: "step 1", def: "buy a Friend", x: 200, y: 45, w: 140, h: 170, style: "plain" },
    { key: "s2", label: "step 2", def: "hardwire it", x: 550, y: 45, w: 140, h: 170, style: "plain" },
    { key: "s3", label: "step 3 (and 4)", def: "the rewards go to the Friend's wallet", x: 200, y: 270, w: 140, h: 165, style: "plain" },
    { key: "s4", label: "step 4", def: "the rewards go to the Friend's wallet", x: 550, y: 270, w: 140, h: 165, style: "plain" },
  ],
  bank: [["buy a Friend", "hardwire it", "the rewards go to the Friend's wallet", "the rewards go to the Friend's wallet"], ["hardwire 4,000 Gen-6s", "farm the airdrop", "the weight is 1.1 each", "the weight is 1.1 each"], ["sell the Friend at the top", "keep the rewards", "the rewards follow the NFT", "the rewards follow the NFT"], ["read the home page APR", "buy in", "that number is protocol-wide", "that number is protocol-wide"]],
});

const bernie = photo({
  id: "bernie", name: "Once again asking", blurb: "for exactly one thing", src: "bernie.jpg", w: 750, h: 750,
  faces: [{ x: 310, y: 185, w: 200, h: 200, rot: 0.02 }],
  boxes: [
    { key: "top", label: "top line", def: "", x: 30, y: 20, w: 690, h: 140, style: "impact" },
    { key: "ask", label: "asking for…", def: "for you to hardwire", x: 30, y: 650, w: 690, h: 90, style: "impact" },
  ],
  bank: [["", "for you to hardwire"], ["", "for the API to come back"], ["", "for 1 RF"], ["", "for you to check the block number"], ["me at 4am", "for one more block"]],
});

const pigeon = photo({
  id: "pigeon", name: "Is this a pigeon?", blurb: "pointing at a butterfly, confidently wrong", src: "pigeon.jpg", w: 1587, h: 1425,
  faces: [{ x: 160, y: 320, w: 500, h: 500, rot: -0.05 }],
  boxes: [
    { key: "who", label: "the pointer", def: "me", x: 100, y: 1130, w: 640, h: 130, style: "impact" },
    { key: "what", label: "the butterfly", def: "a Gen-6 earning $0.0004 a week", x: 1050, y: 480, w: 520, h: 150, style: "impact" },
    { key: "q", label: "the question", def: "is this yield?", x: 60, y: 1270, w: 1467, h: 140, style: "impact" },
  ],
  bank: [["me", "a Gen-6 earning $0.0004 a week", "is this yield?"], ["me", "the home page APR", "is this my APR?"], ["me", "a temp Friend", "is this an NFT?"], ["crypto twitter", "a 502 error", "is this a rug?"]],
});

const panik = photo({
  id: "panik", name: "Panik · kalm · panik", blurb: "three rows, one nervous system", src: "panik.png", w: 640, h: 881,
  faces: [{ x: 388, y: 26, w: 170, h: 170, rot: 0.15 }, { x: 392, y: 325, w: 170, h: 170 }, { x: 388, y: 622, w: 170, h: 170, rot: -0.15 }],
  boxes: [
    { key: "r1", label: "panik", def: "the API is down", x: 20, y: 30, w: 270, h: 240, style: "plain" },
    { key: "r2", label: "kalm", def: "rewards still accrue on chain", x: 20, y: 320, w: 270, h: 250, style: "plain" },
    { key: "r3", label: "panik again", def: "I can't see them though", x: 20, y: 620, w: 270, h: 240, style: "plain" },
  ],
  bank: [["the API is down", "rewards still accrue on chain", "I can't see them though"], ["RF is down 18%", "my APR went up", "because RF is down 18%"], ["sold my Friend", "got the ETH", "activation cleared on transfer"], ["a temp Friend appeared", "it's free", "it vanishes if I spend 1 RF"]],
});

const doge = photo({
  id: "doge", name: "Buff doge vs cheems", blurb: "same species, different era", src: "doge.png", w: 937, h: 720,
  faces: [{ x: 192, y: 78, w: 116, h: 116, rot: 0.08 }, { x: 698, y: 172, w: 116, h: 116, rot: -0.1 }],
  boxes: [
    { key: "buff", label: "buff", def: "hardwired Friend", x: 20, y: 540, w: 450, h: 160, style: "impact" },
    { key: "cheems", label: "cheems", def: "temp Friend", x: 480, y: 540, w: 440, h: 160, style: "impact" },
  ],
  bank: [["hardwired Friend", "temp Friend"], ["a Genesis holder's APR", "my APR"], ["holders in 2026", "holders in 2021"], ["1 RF, hardwired", "1 RF"]],
});

const trade = photo({
  id: "trade", name: "Trade offer", blurb: "i receive · you receive", src: "trade.jpg", w: 607, h: 794,
  faces: [{ x: 222, y: 292, w: 176, h: 176 }],
  boxes: [
    { key: "get", label: "i receive", def: "1 RF", x: 20, y: 185, w: 280, h: 110, style: "impact" },
    { key: "give", label: "you receive", def: "a permanent Gen-6 with its own wallet", x: 310, y: 185, w: 280, h: 110, style: "impact" },
  ],
  bank: [["1 RF", "a permanent Gen-6 with its own wallet"], ["100,000 RF", "2,000,000 weight and a personality"], ["your temp Friend", "nothing. it can't transfer."], ["a screenshot of my APR", "engagement"], ["your ETH", "a Friend that earns ETH"]],
});

const always = photo({
  id: "always", name: "Always has been", blurb: "two astronauts, one revelation", src: "always.png", w: 960, h: 540,
  faces: [{ x: 414, y: 244, w: 112, h: 112, rot: -0.05 }, { x: 748, y: 62, w: 134, h: 134, rot: -0.15 }],
  boxes: [
    { key: "q", label: "the question", def: "wait, it's all APR?", x: 20, y: 20, w: 600, h: 110, style: "impact" },
    { key: "a", label: "the answer", def: "always has been", x: 560, y: 420, w: 380, h: 100, style: "impact" },
  ],
  bank: [["wait, it's all APR?", "always has been"], ["wait, Friends have wallets?", "always have"], ["wait, the rewards stay with the NFT?", "always have"], ["wait, the 7,000% is protocol-wide?", "always has been"]],
});

const fine = photo({
  id: "fine", name: "This is fine", blurb: "flames, coffee, unwavering calm", src: "fine.jpg", w: 580, h: 282,
  faces: [{ x: 96, y: 96, w: 70, h: 70 }, { x: 336, y: 96, w: 112, h: 112 }],
  cover: [{ x: 366, y: 18, w: 180, h: 48, color: "#fdfbf3" }],
  boxes: [{ key: "line", label: "the bubble", def: "this is fine", x: 368, y: 20, w: 176, h: 44, style: "plain" }],
  bank: [["this is fine"], ["everything is fine"], ["wen rescue"], ["still streaming"], ["502, whatever"]],
});

const pikachu = photo({
  id: "pikachu", name: "Surprised Pikachu", blurb: "the consequences of my own actions", src: "pikachu.jpg", w: 1893, h: 1893,
  faces: [{ x: 690, y: 1200, w: 560, h: 560, rot: 0.04 }],
  boxes: [{ key: "top", label: "the setup", def: "sells the Friend, loses the activation", x: 60, y: 60, w: 1773, h: 640, style: "plain" }],
  bank: [["sells the Friend, loses the activation"], ["reads 7,000% on the home page, gets 600% on a Gen-6"], ["spends the 1 RF, the temp Friend disappears"], ["checks the block number at 4am, it went up"]],
});

const cat = photo({
  id: "cat", name: "Woman yelling at cat", blurb: "two sides, one salad", src: "cat.jpg", w: 680, h: 438,
  faces: [{ x: 60, y: 140, w: 150, h: 150, rot: -0.1 }, { x: 466, y: 196, w: 120, h: 120, rot: 0.05 }],
  boxes: [
    { key: "woman", label: "the yelling", def: "you can't earn 9,000% APR", x: 10, y: 8, w: 325, h: 86, style: "plain" },
    { key: "cat", label: "the cat", def: "my Friend, quietly earning 9,954%", x: 348, y: 8, w: 322, h: 86, style: "plain" },
  ],
  bank: [["you can't earn 9,000% APR", "my Friend, quietly earning 9,954%"], ["the API is down, it's over", "block 65,040,341, still streaming"], ["just sell the NFT", "activation cleared on transfer"], ["Gen-6 is worthless", "1.1 weight, permanently"]],
});

const harold = photo({
  id: "harold", name: "Hide the pain", blurb: "smiling through it", src: "harold.jpg", w: 480, h: 601,
  faces: [{ x: 292, y: 24, w: 100, h: 100, rot: 0.05 }, { x: 292, y: 328, w: 100, h: 100, rot: 0.05 }],
  boxes: [
    { key: "top", label: "top panel", def: "me showing my APR", x: 20, y: 200, w: 440, h: 90, style: "impact" },
    { key: "bottom", label: "bottom panel", def: "me hiding that it's a Gen-6", x: 20, y: 505, w: 440, h: 90, style: "impact" },
  ],
  bank: [["me showing my APR", "me hiding that it's a Gen-6"], ["reads 'temp' on my card", "smiles"], ["watching the wallet farmers", "holding one Genesis like a gentleman"], ["API returns 502", "refresh"]],
});

const uno = photo({
  id: "uno", name: "Draw 25", blurb: "or draw 25", src: "uno.jpg", w: 500, h: 494,
  faces: [{ x: 318, y: 52, w: 92, h: 92, rot: 0.1 }],
  boxes: [
    { key: "card", label: "the card", def: "hardwire your Friend", x: 30, y: 140, w: 190, h: 120, style: "plain" },
    { key: "who", label: "who", def: "me, holding 25 temps", x: 260, y: 400, w: 230, h: 84, style: "impact" },
  ],
  bank: [["hardwire your Friend", "me, holding 25 temps"], ["read the docs", "crypto twitter"], ["claim your rewards", "me, letting them compound"], ["withdraw before selling", "every seller who lost the rewards"]],
});

const pooh = photo({
  id: "pooh", name: "Tuxedo Pooh", blurb: "the fancy way to say it", src: "pooh.png", w: 800, h: 582,
  faces: [{ x: 150, y: 18, w: 180, h: 180, rot: 0.05 }, { x: 150, y: 322, w: 180, h: 180, rot: 0.05 }],
  boxes: [
    { key: "top", label: "plain", def: "holding NFTs", x: 360, y: 30, w: 420, h: 240, style: "plain" },
    { key: "bottom", label: "fancy", def: "holding Friends that have wallets", x: 360, y: 320, w: 420, h: 240, style: "plain" },
  ],
  bank: [["holding NFTs", "holding Friends that have wallets"], ["APR", "current active stream ÷ RF you paid to activate · annualized"], ["temp Friend", "balance-dependent companion"], ["buying Gen-6s", "acquiring 1.1 weight units"]],
});

const monkey = photo({
  id: "monkey", name: "Monkey puppet", blurb: "the side eye", src: "monkey.jpg", w: 923, h: 768,
  faces: [{ x: 175, y: 355, w: 240, h: 240, rot: -0.05 }, { x: 635, y: 355, w: 240, h: 240, rot: 0.05 }],
  boxes: [{ key: "top", label: "the moment", def: "when someone asks if I read the docs", x: 40, y: 30, w: 843, h: 220, style: "plain" }],
  bank: [["when someone asks if I read the docs"], ["when the group chat asks who bought 4,000 Gen-6s"], ["when my Friend earns more than me this week"], ["when the API comes back and my APR went up"]],
});

const exit = photo({
  id: "exit", name: "Left exit 12", blurb: "the swerve", src: "exit.jpg", w: 804, h: 767,
  faces: [],
  boxes: [
    { key: "straight", label: "straight ahead", def: "claim rewards", x: 195, y: 100, w: 125, h: 150, style: "impact" },
    { key: "exit", label: "the exit", def: "check pending again", x: 412, y: 100, w: 168, h: 150, style: "impact" },
    { key: "car", label: "the car", def: "me", x: 280, y: 570, w: 320, h: 90, style: "impact" },
  ],
  bank: [["claim rewards", "check pending again", "me"], ["hold the token", "hold a Friend", "my portfolio"], ["sleep", "block number", "me at 4am"], ["sell at the top", "hardwire another one", "the farmers"]],
});

// ---------- pack 3: ten more real templates ----------

const batman = photo({
  id: "batman", name: "Batman slapping Robin", blurb: "one bad take, one open hand", src: "batman.jpg", w: 400, h: 387,
  faces: [{ x: 120, y: 170, w: 96, h: 96, rot: -0.12 }, { x: 258, y: 118, w: 90, h: 90, rot: 0.06 }],
  boxes: [
    { key: "robin", label: "Robin says", def: "I'll sell it and keep the rewards", x: 22, y: 16, w: 186, h: 74, style: "plain" },
    { key: "batman", label: "Batman says", def: "the rewards follow the NFT", x: 218, y: 14, w: 166, h: 72, style: "plain" },
  ],
  bank: [["I'll sell it and keep the rewards", "the rewards follow the NFT"], ["7,000% APR on the home page", "that's protocol-wide"], ["I'll just spend this 1 RF", "that's your temp Friend"], ["is the API down", "read the block number"], ["APY", "APR"], ["I'll claim and hold it myself", "the Friend holds it"]],
});

const spongebob = photo({
  id: "spongebob", name: "Mocking SpongeBob", blurb: "sAy It AgAiN", src: "spongebob.jpg", w: 502, h: 353,
  faces: [{ x: 134, y: 122, w: 160, h: 160, rot: 0.08 }],
  boxes: [
    { key: "top", label: "what they said", def: "you can't earn 9,000% APR", x: 16, y: 8, w: 470, h: 64, style: "impact" },
    { key: "bottom", label: "what they sounded like", def: "you can't earn 9,000% APR", x: 16, y: 286, w: 470, h: 60, style: "impact", mock: true },
  ],
  bank: [["you can't earn 9,000% APR", "you can't earn 9,000% APR"], ["just sell the NFT", "just sell the NFT"], ["it's only a temp Friend", "it's only a temp Friend"], ["Gen-6 is worthless", "Gen-6 is worthless"], ["the APR is unsustainable", "the APR is unsustainable"], ["I read the docs", "I read the docs"]],
});

const aliens = photo({
  id: "aliens", name: "Ancient Aliens", blurb: "I'm not saying it was Friends", src: "aliens.jpg", w: 500, h: 436,
  faces: [{ x: 190, y: 98, w: 158, h: 158, rot: 0.03 }],
  boxes: [
    { key: "top", label: "the question", def: "how does a Gen-6 earn ETH", x: 16, y: 8, w: 468, h: 62, style: "impact" },
    { key: "bottom", label: "the answer", def: "Friends", x: 16, y: 364, w: 468, h: 64, style: "impact" },
  ],
  bank: [["how does a Gen-6 earn ETH", "Friends"], ["who buys the token every block", "Friends"], ["where do the rewards go when I sell", "they follow the NFT"], ["7,000% APR?", "hardwire"], ["my Friend has its own wallet", "and it's richer than mine"], ["the block number went up", "yield"]],
});

const rollsafe = photo({
  id: "rollsafe", name: "Roll Safe", blurb: "think about it", src: "rollsafe.jpg", w: 702, h: 395,
  faces: [{ x: 132, y: 86, w: 168, h: 168, rot: 0.06 }],
  boxes: [
    { key: "top", label: "can't", def: "can't lose the rewards on transfer", x: 20, y: 8, w: 662, h: 70, style: "impact" },
    { key: "bottom", label: "if", def: "if you withdraw the Friend's wallet first", x: 20, y: 318, w: 662, h: 70, style: "impact" },
  ],
  bank: [["can't lose the rewards on transfer", "if you withdraw the Friend's wallet first"], ["can't miss the dip", "if the Friend buys every block"], ["can't panic about the API", "if you only read the chain"], ["can't be late to hardwire", "if you hardwire now"], ["can't lose a temp Friend", "if you never spend the 1 RF"], ["can't lie about your APR", "if you post the card"]],
});

const spiderman = photo({
  id: "spiderman", name: "Spider-Man pointing", blurb: "two of them, both right", src: "spiderman.jpg", w: 800, h: 450,
  faces: [{ x: 190, y: 26, w: 84, h: 84, rot: -0.1 }, { x: 556, y: 24, w: 84, h: 84, rot: 0.1 }],
  boxes: [
    { key: "left", label: "left", def: "me checking pending", x: 20, y: 340, w: 340, h: 96, style: "impact" },
    { key: "right", label: "right", def: "my Friend checking pending", x: 440, y: 340, w: 340, h: 96, style: "impact" },
  ],
  bank: [["me checking pending", "my Friend checking pending"], ["a Gen-6 holder", "another Gen-6 holder"], ["me at 4am", "the block number"], ["my wallet", "my Friend's wallet"], ["temp Friend", "temp Friend"], ["someone posting their APR", "someone posting their APR"]],
});

const pablo = photo({
  id: "pablo", name: "Sad Pablo", blurb: "three rooms, one wait", src: "pablo.jpg", w: 720, h: 709,
  faces: [{ x: 262, y: 20, w: 112, h: 112, rot: 0.02 }, { x: 52, y: 386, w: 64, h: 64, rot: -0.06 }, { x: 606, y: 468, w: 54, h: 54, rot: 0.04 }],
  boxes: [{ key: "top", label: "the wait", def: "waiting for the next block", x: 390, y: 16, w: 316, h: 200, style: "impact" }],
  bank: [["waiting for the next block"], ["me after selling the Friend without withdrawing its wallet"], ["waiting for the API to come back"], ["holding a temp Friend I can't transfer"], ["pending is $0.42 and it's Monday"], ["waiting for the hardwire to clear"]],
});

const cheers = photo({
  id: "cheers", name: "DiCaprio cheers", blurb: "a toast, a smirk", src: "cheers.jpg", w: 600, h: 400,
  faces: [{ x: 236, y: 56, w: 164, h: 164, rot: 0.04 }],
  boxes: [
    { key: "top", label: "to", def: "to the Friends", x: 16, y: 8, w: 568, h: 60, style: "impact" },
    { key: "bottom", label: "who", def: "that hold the bag for us", x: 16, y: 332, w: 568, h: 60, style: "impact" },
  ],
  bank: [["to the Friends", "that hold the bag for us"], ["cheers to everyone", "who hardwired before the block"], ["to my Friend", "who earned more than me this week"], ["to the wallet farmers", "may your 4,000 Gen-6s stay 1.1 each"], ["to APR", "the honest cousin of APY"], ["cheers", "the block number went up"]],
});

const anakin = photo({
  id: "anakin", name: "Anakin and Padme", blurb: "for the better, right?", src: "anakin.png", w: 768, h: 768,
  faces: [{ x: 104, y: 52, w: 162, h: 162, rot: -0.04 }, { x: 460, y: 70, w: 210, h: 210, rot: 0.04 }, { x: 84, y: 460, w: 220, h: 220, rot: 0.03 }, { x: 464, y: 456, w: 210, h: 210, rot: -0.03 }],
  boxes: [
    { key: "p1", label: "panel 1", def: "I'm going to sell my Friend", x: 10, y: 282, w: 364, h: 90, style: "impact" },
    { key: "p2", label: "panel 2", def: "after you withdraw its wallet, right?", x: 394, y: 282, w: 364, h: 90, style: "impact" },
    { key: "p3", label: "panel 3 (silence)", def: "", x: 10, y: 666, w: 364, h: 90, style: "impact" },
    { key: "p4", label: "panel 4", def: "after you withdraw its wallet, right?", x: 394, y: 666, w: 364, h: 90, style: "impact" },
  ],
  bank: [["I'm going to sell my Friend", "after you withdraw its wallet, right?", "", "after you withdraw its wallet, right?"], ["I hardwired 4,000 Gen-6s", "for the weight, right?", "", "for the weight, right?"], ["I'm earning 7,000% APR", "on the portfolio page, right?", "", "on the portfolio page, right?"], ["I got a free Friend", "you kept the 1 RF, right?", "", "you kept the 1 RF, right?"], ["I read the docs", "all of them, right?", "", "all of them, right?"]],
});

const theydontknow = photo({
  id: "theydontknow", name: "They don't know", blurb: "alone in the corner, fully aware", src: "theydontknow.png", w: 671, h: 673,
  faces: [{ x: 106, y: 44, w: 100, h: 100, rot: -0.04 }],
  boxes: [{ key: "thought", label: "the thought", def: "they don't know my Friend has its own wallet", x: 250, y: 14, w: 406, h: 150, style: "plain" }],
  bank: [["they don't know my Friend has its own wallet"], ["they don't know I'm hardwired"], ["they don't know the block number"], ["they don't know I'm here for the APR"], ["they don't know my temp Friend is watching"], ["they don't know the rewards follow the NFT"]],
});

const boardroom = photo({
  id: "boardroom", name: "Boardroom suggestion", blurb: "three ideas, one window", src: "boardroom.jpg", w: 500, h: 649,
  faces: [{ x: 384, y: 312, w: 56, h: 56, rot: 0.06 }, { x: 132, y: 546, w: 68, h: 68, rot: 0.1 }],
  boxes: [
    { key: "boss", label: "the boss asks", def: "how do we grow the protocol?", x: 150, y: 10, w: 290, h: 54, style: "plain" },
    { key: "s1", label: "idea 1", def: "buy the token", x: 30, y: 253, w: 94, h: 40, style: "plain" },
    { key: "s2", label: "idea 2", def: "market the token", x: 168, y: 257, w: 76, h: 34, style: "plain" },
    { key: "s3", label: "idea 3 (out the window)", def: "hardwire a Friend", x: 314, y: 265, w: 122, h: 46, style: "plain" },
  ],
  bank: [["how do we grow the protocol?", "buy the token", "market the token", "hardwire a Friend"], ["why is APR down?", "RF pumped", "less pending", "you're reading the home page"], ["how do I keep my rewards?", "claim them", "hold them", "withdraw the Friend's wallet before selling"], ["what's the best NFT?", "a Genesis", "a Gen-1", "a temp Friend on 1 RF"], ["how do we fix the API?", "retry", "cache", "read the chain"]],
});

// ---------- code-drawn, work on any art ----------

const classic: Template = {
  id: "classic", name: "Classic", blurb: "top text · bottom text · nothing else needed", w: W, h: H,
  fields: [
    { key: "top", label: "top text", def: "WEN HARDWIRE", max: 40 },
    { key: "bottom", label: "bottom text", def: "SOON", max: 40 },
  ],
  bank: [["WEN HARDWIRE", "SOON"], ["ME CHECKING MY APR", "EVERY 4 MINUTES"], ["THEY ASKED WHAT I DO", "MY FRIEND COLLECTS CRYPTO"], ["CLAIMABLE $0.42", "WE EAT TONIGHT"], ["TEMP FRIEND", "BALANCE DEPENDENT LIKE ME"], ["ONE DOES NOT SIMPLY", "SELL A HARDWIRED FRIEND"]],
  draw(ctx, p) {
    if (p.transparent) rect(ctx, 0, 0, W, H, "#111");
    drawPfp(ctx, p.pfp, 0, 0, W, { pixelate: p.pixelate, bg: BLACK, transparent: p.transparent });
    impactText(ctx, t(p, "top", classic), W / 2, 30, 108, W - 100, p.fonts, "top");
    impactText(ctx, t(p, "bottom", classic), W / 2, H - 30, 108, W - 100, p.fonts, "bottom");
  },
};

const dealwithit: Template = {
  id: "dealwithit", name: "Deal with it", blurb: "the sunglasses have landed", w: W, h: H,
  fields: [{ key: "line", label: "caption", def: "DEAL WITH IT", max: 24 }],
  bank: [["DEAL WITH IT"], ["HARDWIRED"], ["NOT SELLING"], ["APR GOES UP"], ["STILL HERE AFTER THE 502"]],
  draw(ctx, p) {
    rect(ctx, 0, 0, W, H, "#7d3cff");
    confetti(ctx, 50, ["#a67bff", "#5b2bd6"], 9, 14, 40);
    drawPfp(ctx, p.pfp, 90, 90, 900, { pixelate: p.pixelate, bg: BLACK, transparent: p.transparent });
    frame(ctx, 90, 90, 900, 900, 14, WHITE);
    const gx = W / 2 - 7 * 28, gy = 330, gs = 28;
    for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [-6, -6], [6, 6], [-6, 6], [6, -6]]) sprite(ctx, SHADES, mono(WHITE), gx + dx, gy + dy, gs);
    sprite(ctx, SHADES, mono(BLACK), gx, gy, gs);
    impactText(ctx, t(p, "line", dealwithit), W / 2, H - 40, 120, W - 80, p.fonts, "bottom");
  },
};

const card: Template = {
  id: "card", name: "Holo card", blurb: "foil finish, questionable stats", w: W, h: H,
  fields: [
    { key: "name", label: "name", def: "RARE FRIEND", max: 18 },
    { key: "s1", label: "stat 1", def: "APR  9,954%", max: 20 },
    { key: "s2", label: "stat 2", def: "WEIGHT  2,000,000", max: 20 },
    { key: "s3", label: "stat 3", def: "RARITY  1 OF 1,024", max: 20 },
  ],
  bank: [["RARE FRIEND", "APR  9,954%", "WEIGHT  2,000,000", "RARITY  1 OF 1,024"], ["GEN-6 ENJOYER", "APR  5,210%", "WEIGHT  1.1", "COST  1 RF"], ["TEMP FRIEND", "APR  0%", "WEIGHT  0", "STATUS  BALANCE DEPENDENT"], ["WALLET FARMER", "FRIENDS  4,000", "WEIGHT  4,400", "REGRET  IMMEASURABLE"]],
  draw(ctx, p) {
    rect(ctx, 0, 0, W, H, "#101010");
    const cx = 120, cy = 50, cw = 840, ch = 980;
    ctx.save(); ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip(); ctx.translate(cx, cy); ctx.rotate(-0.3);
    stripes(ctx, ["#ff9ad5", "#ffd27a", "#b6ffb0", "#9ad7ff", "#d9a3ff"], -600, 1800, 60);
    ctx.restore();
    frame(ctx, cx, cy, cw, ch, 16, BLACK);
    rect(ctx, cx + 40, cy + 40, cw - 80, 90, BLACK);
    pxText(ctx, t(p, "name", card).toUpperCase(), W / 2, cy + 102, 40, LIME, p.fonts, "center", 3);
    sprite(ctx, CROWN, mono(YELLOW), cx + 56, cy + 52, 9);
    const art = 600;
    drawPfp(ctx, p.pfp, W / 2 - art / 2, cy + 160, art, { pixelate: p.pixelate, bg: BLACK, transparent: p.transparent });
    frame(ctx, W / 2 - art / 2, cy + 160, art, art, 12, BLACK);
    const sy = cy + 160 + art + 24, shh = 138;
    rect(ctx, cx + 40, sy, cw - 80, shh, WHITE); frame(ctx, cx + 40, sy, cw - 80, shh, 8, BLACK);
    ["s1", "s2", "s3"].forEach((k, i) => pxText(ctx, t(p, k, card).toUpperCase(), cx + 76, sy + 46 + i * 40, 24, BLACK, p.fonts, "left", 1));
    pxText(ctx, "★ RARE FRIENDS · 2026 ★", W / 2, cy + ch - 26, 16, BLACK, p.fonts, "center", 2);
  },
};

export const TEMPLATES: Template[] = [drake, distracted, buttons, changemind, brain, gru, bernie, pigeon, panik, doge, trade, always, fine, pikachu, cat, harold, uno, pooh, monkey, exit, batman, spongebob, aliens, rollsafe, spiderman, pablo, cheers, anakin, theydontknow, boardroom, classic, dealwithit, card];
