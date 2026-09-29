"use client";
import type { ReactNode } from "react";

/**
 * Makes the inline card tappable: opens the same PNG full size in a new tab, where a phone can pinch it and
 * long-press to save. Reads the image already on the page (like DownloadCard) so the HTML still carries it once.
 * Opened as a blob URL because browsers refuse to navigate a tab to a data: URL, and decoded synchronously so the
 * open stays inside the tap and popup blockers let it through.
 */
export function CardZoom({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <button
        type="button"
        className="cardzoom"
        aria-label={label}
        onClick={(e) => {
          const src = e.currentTarget.querySelector("img")?.src;
          if (!src?.startsWith("data:")) return;
          const [head, b64] = src.split(",");
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes], { type: head.slice(5).split(";")[0] }));
          window.open(url, "_blank", "noopener");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }}
      >
        {children}
      </button>
      <p className="zoomhint">tap the card to open it full size</p>
    </>
  );
}
