import type { Metadata } from "next";
import { MemeMaker } from "@/components/memes/MemeMaker";

const DESCRIPTION = "Drop your PFP or pick one of your Rare Friends. Twenty-three meme templates you already know, with your Friend in the frame. Drawn in your browser, nothing uploaded.";

export const metadata: Metadata = {
  title: "Meme Machine · Rare Friends Cards",
  description: DESCRIPTION,
  alternates: { canonical: "/memes" },
  openGraph: { title: "Rare Friends Meme Machine", description: DESCRIPTION, url: "/memes" },
  twitter: { card: "summary_large_image", title: "Rare Friends Meme Machine", description: DESCRIPTION },
};

export default function MemesPage() {
  return (
    <main className="wrap wide" id="main">
      <header className="pagehead">
        <h1 className="px">MEME MACHINE</h1>
        <div className="chip">[ 23 formats · all gens ]</div>
      </header>
      <p className="tag">Drop your PFP, paste it, or pull a Friend straight from your wallet. Every meme is assembled in your browser. Edit the captions, shuffle them, download or copy.</p>
      <MemeMaker />
      <p className="foot muted">Nothing is uploaded; the image never leaves your browser. Not affiliated with Rare Friends.</p>
    </main>
  );
}
