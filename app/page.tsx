import Link from "next/link";
import { AddressForm } from "@/components/AddressForm";

export default function Home() {
  return (
    <main className="wrap home" id="main">
      <section className="hero two">
        <div className="door door-cards">
          <span className="lbl">01 · stat cards</span>
          <h1 className="px">RARE FRIENDS<br />CARDS</h1>
          <p className="tag">Friends have wallets. Wallets have Friends. Friends collect crypto.<br />Paste a wallet, get a card for the whole portfolio and one for every Friend in it.</p>
          <AddressForm />
        </div>
        <div className="door door-memes">
          <span className="lbl">02 · meme machine</span>
          <h2 className="px">MEME<br />MACHINE</h2>
          <p className="tag">Drop your PFP or pull a Friend from your wallet. Drake, distracted boyfriend, two buttons, Gru’s plan, trade offer, expanding brain, surprised Pikachu and sixteen more, with your Friend pasted in. Made in your browser, nothing uploaded.</p>
          <div className="doorstrip" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="doortile"><img src="/memes/drake.jpg" alt="" /><small>drake</small></span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="doortile"><img src="/memes/distracted.jpg" alt="" /><small>distracted</small></span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="doortile"><img src="/memes/buttons.jpg" alt="" /><small>two buttons</small></span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="doortile"><img src="/memes/pigeon.jpg" alt="" /><small>pigeon</small></span>
          </div>
          <Link className="btn primary lime" href="/memes">[ make memes → ]</Link>
        </div>
      </section>


      <p className="foot muted">Community tool by <a href="https://halldon.com" target="_blank" rel="noreferrer">Halldon</a>. Reads public data from rarefriends.com. Not affiliated with Rare Friends.</p>
    </main>
  );
}
