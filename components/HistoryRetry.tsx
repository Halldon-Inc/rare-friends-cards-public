"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TRIES = 3;

/**
 * Shown in the APR cell when the page rendered before the wallet's activation history arrived (a cold wallet on a
 * slow log index). It asks the history route to finish the read, then refreshes the page, whose APR and card fill in
 * from the now-warm caches. Only when that keeps failing does it say the history is unavailable.
 */
export function HistoryRetry() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= TRIES) return;
    let live = true;
    fetch(`${window.location.pathname.replace(/\/$/, "")}/history`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({ known: false }))
      .then((j: { known?: boolean }) => {
        if (!live) return;
        if (j.known) router.refresh();
        // Still mounted after a refresh means the page still lacks the history: the next effect run tries again.
        setTimeout(() => live && setTries((n) => n + 1), j.known ? 4_000 : 1_500);
      });
    return () => {
      live = false;
    };
  }, [tries, router]);
  return <>{tries >= TRIES ? "activation history unavailable right now" : "reading the activation history…"}</>;
}
