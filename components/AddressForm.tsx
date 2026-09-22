"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const isHex = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);
// Same shape test as the server (lib/rarefriends.ts ENS_NAME); viem's normalize() does the strict check there.
const isEnsShaped = (s: string) => /^[^\s./\\]{1,63}(\.[^\s./\\]{1,63})+$/u.test(s);

export function AddressForm() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = isHex(q.trim()) || isEnsShaped(q.trim());

  return (
    <form
      className="lookup"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (!ok) { setErr("paste a 0x wallet address or an ENS name"); return; }
        setErr(null); setBusy(true);
        router.push(`/card/${encodeURIComponent(isHex(v) ? v : v.toLowerCase())}`);
      }}
    >
      <label htmlFor="addr" className="lbl">wallet address or ENS</label>
      <div className="lookuprow">
        <input
          id="addr"
          name="addr"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="0x… or name.eth"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
        />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "[ loading… ]" : "[ make my card → ]"}</button>
      </div>
      {err ? <div className="err" role="alert">{err}</div> : <div className="hint">read-only. no wallet connect, no signing, nothing to approve.</div>}
    </form>
  );
}
