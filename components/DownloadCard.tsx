"use client";

/** Saves the card image already on the page (the inline PNG rendered with the strip), so the HTML carries it once. */
export function DownloadCard({ filename }: { filename: string }) {
  return (
    <button
      className="btn"
      type="button"
      onClick={() => {
        const img = document.querySelector<HTMLImageElement>("img.card");
        if (!img?.src) return;
        const a = document.createElement("a");
        a.href = img.src;
        a.download = filename;
        a.click();
      }}
    >
      [ download png ]
    </button>
  );
}
