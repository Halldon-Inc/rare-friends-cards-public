"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TEMPLATES, type Template } from "./templates";
import { W, type Fonts } from "./pixel";
import { imageFromBlob, loadImage, prepare, placeholderSource, type Source } from "./image";

type FriendPick = { id: string | number; label: string; title: string; imageUrl?: string; earning: boolean };
type Texts = Record<string, Record<string, string>>;

const PREVIEW = 540;

function defaults(): Texts {
  const t: Texts = {};
  for (const tpl of TEMPLATES) t[tpl.id] = Object.fromEntries(tpl.fields.map((f) => [f.key, f.def]));
  return t;
}

const images = new Map<string, HTMLImageElement>();
/** Preload every photo template once; resolves when all are usable. */
function preloadImages() {
  return Promise.all(TEMPLATES.filter((t) => t.src && !images.has(t.id)).map((t) => new Promise<void>((res) => {
    const img = new Image();
    img.onload = () => { images.set(t.id, img); res(); };
    img.onerror = () => res();
    img.src = t.src!;
  })));
}

/** Render at `width` px wide; height follows the template's own aspect ratio. */
function render(tpl: Template, width: number, src: Source, texts: Texts, fonts: Fonts) {
  const scale = width / tpl.w;
  const c = document.createElement("canvas");
  c.width = Math.round(tpl.w * scale);
  c.height = Math.round(tpl.h * scale);
  const ctx = c.getContext("2d")!;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.imageSmoothingQuality = "high";
  tpl.draw(ctx, { pfp: src.canvas, text: texts[tpl.id] ?? {}, fonts, pixelate: src.pixelArt, pixelArt: src.pixelArt, transparent: src.transparent, image: images.get(tpl.id) });
  ctx.restore();
  return c;
}

const blobOf = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("no blob"))), "image/png"));

export function MemeMaker() {
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [raw, setRaw] = useState<{ img: HTMLImageElement; label: string } | null>(null);
  const [trim, setTrim] = useState(true);
  const [knockout, setKnockout] = useState(false);
  const [texts, setTexts] = useState<Texts>(defaults);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [friends, setFriends] = useState<FriendPick[] | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<Record<string, number>>({});

  // Fonts: Silkscreen comes from next/font (a hashed family name in the CSS variable); Impact is a system font.
  useEffect(() => {
    const px = getComputedStyle(document.documentElement).getPropertyValue("--f-px").trim() || "Silkscreen";
    const f: Fonts = { px, impact: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif" };
    Promise.all([document.fonts.load(`32px ${px}`), document.fonts.load(`bold 32px ${f.impact}`), preloadImages()]).catch(() => {}).finally(() => setFonts(f));
    setSource(placeholderSource());
  }, []);

  // Re-prepare when the source image or the processing toggles change.
  useEffect(() => {
    if (!raw) return;
    try {
      setSource(prepare(raw.img, { trim, knockout, label: raw.label }));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [raw, trim, knockout]);

  const renderOne = useCallback((tpl: Template) => {
    if (!fonts || !source) return;
    const c = render(tpl, PREVIEW, source, texts, fonts);
    setPreviews((p) => ({ ...p, [tpl.id]: c.toDataURL("image/png") }));
  }, [fonts, source, texts]);

  // Full re-render (staggered so the page stays responsive) when the image or a global toggle changes.
  useEffect(() => {
    if (!fonts || !source) return;
    let cancelled = false;
    let i = 0;
    const step = () => {
      if (cancelled || i >= TEMPLATES.length) return;
      renderOne(TEMPLATES[i++]);
      setTimeout(step, 0);
    };
    step();
    return () => { cancelled = true; };
    // texts are handled per template below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonts, source]);

  const setText = (tplId: string, key: string, value: string) => {
    setTexts((t) => ({ ...t, [tplId]: { ...t[tplId], [key]: value } }));
  };
  // Per-template debounced re-render on caption edits.
  const textsRef = useRef(texts);
  textsRef.current = texts;
  useEffect(() => {
    for (const tpl of TEMPLATES) {
      const key = JSON.stringify(texts[tpl.id]);
      if (timers.current[tpl.id + ":last"] === (key as unknown as number)) continue;
      timers.current[tpl.id + ":last"] = key as unknown as number;
      window.clearTimeout(timers.current[tpl.id]);
      timers.current[tpl.id] = window.setTimeout(() => renderOne(tpl), 180);
    }
  }, [texts, renderOne]);

  const useBlob = async (blob: Blob, label: string) => {
    try {
      const img = await imageFromBlob(blob);
      setRaw({ img, label });
      setFriends(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // Drop and paste anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((x) => x.type.startsWith("image/"));
      const f = item?.getAsFile();
      if (f) { e.preventDefault(); void useBlob(f, f.name || "pasted image"); }
    };
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith("image/")) void useBlob(f, f.name);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("paste", onPaste); window.removeEventListener("dragover", prevent); window.removeEventListener("drop", onDrop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchFriends = async () => {
    const q = wallet.trim();
    if (!q) return;
    setLoadingFriends(true);
    setErr(null);
    try {
      const r = await fetch(`/api/friends?address=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not read that wallet.");
      setFriends(j.friends);
      setWalletName(j.name);
      if (!j.friends.length) setErr("No Rare Friends in that wallet yet.");
    } catch (e) {
      setErr((e as Error).message);
      setFriends(null);
    } finally {
      setLoadingFriends(false);
    }
  };

  const pickFriend = async (f: FriendPick) => {
    if (!f.imageUrl) return;
    try {
      const img = await loadImage(f.imageUrl);
      setRaw({ img, label: f.title });
      setTrim(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const full = (tpl: Template) => (fonts && source ? render(tpl, tpl.src ? Math.max(1080, tpl.w) : W, source, texts, fonts) : null);

  const download = async (tpl: Template) => {
    const c = full(tpl);
    if (!c) return;
    setBusy(tpl.id);
    const blob = await blobOf(c);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `rarefriends-meme-${tpl.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setBusy(null);
    flash("saved");
  };

  const copy = async (tpl: Template) => {
    const c = full(tpl);
    if (!c) return;
    setBusy(tpl.id);
    try {
      const blob = await blobOf(c);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("copied · paste it anywhere");
    } catch {
      flash("copy not supported here · use download");
    } finally {
      setBusy(null);
    }
  };

  const shuffle = (tpl: Template) => {
    if (!tpl.bank?.length) return;
    const cur = JSON.stringify(tpl.fields.map((f) => texts[tpl.id]?.[f.key] ?? f.def));
    const options = tpl.bank.filter((b) => JSON.stringify(b) !== cur);
    const pick = options[Math.floor(Math.random() * options.length)] ?? tpl.bank[0];
    setTexts((t) => ({ ...t, [tpl.id]: Object.fromEntries(tpl.fields.map((f, i) => [f.key, pick[i] ?? f.def])) }));
  };
  const shuffleAll = () => TEMPLATES.forEach(shuffle);

  const flash = (msg: string, ms = 1800) => {
    setToast(msg);
    window.clearTimeout(timers.current.toast);
    timers.current.toast = window.setTimeout(() => setToast(null), ms);
  };

  const sourceUrl = useMemo(() => source?.canvas.toDataURL("image/png"), [source]);

  return (
    <div className="lab">
      <aside className="labside">
        <div
          className={`drop${dragging ? " is-over" : ""}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
          aria-label="Drop, paste or choose an image"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {sourceUrl ? <img src={sourceUrl} alt="" className="dropimg" /> : <span className="dropimg" />}
          <div className="droptext">
            <b>{raw ? raw.label : "drop your PFP here"}</b>
            <small>{raw ? "drop, paste or click to swap it" : "drag it in · paste it (ctrl+v) · or click to choose"}</small>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void useBlob(f, f.name); e.target.value = ""; }} />
        </div>

        <div className="labblock">
          <span className="lbl">or use one of your Rare Friends</span>
          <form className="lookuprow" onSubmit={(e) => { e.preventDefault(); void fetchFriends(); }}>
            <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x… or name.eth" autoComplete="off" spellCheck={false} aria-label="wallet address or ENS" />
            <button className="btn primary" type="submit" disabled={loadingFriends}>{loadingFriends ? "[ reading… ]" : "[ fetch → ]"}</button>
          </form>
          {friends && friends.length > 0 ? (
            <div className="picker">
              <small className="muted">{walletName} · {friends.length} {friends.length === 1 ? "Friend" : "Friends"} · tap one</small>
              <div className="pickgrid">
                {friends.map((f) => (
                  <button key={`${f.title}`} type="button" className={`pick${raw?.label === f.title ? " is-on" : ""}`} onClick={() => void pickFriend(f)} title={f.title}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {f.imageUrl ? <img src={f.imageUrl} alt="" /> : <span />}
                    <span>{f.label} #{f.id}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="labblock toggles">
          <label><input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> trim empty space around the art</label>
          <label><input type="checkbox" checked={knockout} onChange={(e) => setKnockout(e.target.checked)} /> make black transparent (the art floats on the meme)</label>
          <button className="btn" type="button" onClick={shuffleAll}>[ shuffle all captions ]</button>
        </div>
        {err ? <div className="err" role="alert">{err}</div> : <div className="hint">nothing uploads. every meme is drawn in your browser.</div>}
      </aside>

      <div className="labpack">
        {TEMPLATES.map((tpl) => (
          <article className="meme" key={tpl.id}>
            <div className="memeframe">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {previews[tpl.id] ? <img src={previews[tpl.id]} alt={`${tpl.name} meme`} width={PREVIEW} height={Math.round((PREVIEW * tpl.h) / tpl.w)} /> : <div className="memeloading">rendering…</div>}
            </div>
            <div className="memehead"><b className="px">{tpl.name.toUpperCase()}</b><small className="muted">{tpl.blurb}</small></div>
            <div className="memefields">
              {tpl.fields.map((f) => (
                <label key={f.key}>
                  <span className="lbl">{f.label}</span>
                  <input value={texts[tpl.id]?.[f.key] ?? f.def} maxLength={f.max ?? 60} onChange={(e) => setText(tpl.id, f.key, e.target.value)} />
                </label>
              ))}
            </div>
            <div className="memeactions">
              <button className="btn primary" type="button" disabled={busy === tpl.id} onClick={() => void download(tpl)}>[ download ]</button>
              <button className="btn" type="button" disabled={busy === tpl.id} onClick={() => void copy(tpl)}>[ copy ]</button>
              {tpl.bank ? <button className="btn" type="button" onClick={() => shuffle(tpl)} aria-label={`shuffle ${tpl.name} captions`}>[ ⟳ ]</button> : null}
            </div>
          </article>
        ))}
      </div>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
