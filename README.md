# Rare Friends Cards + Meme Machine

**Live: <https://rare-friends-cards.vercel.app>** | Memes: <https://rare-friends-cards.vercel.app/memes>

Shareable stat cards and memes for Rare Friends holders. Paste a wallet address or ENS name. No wallet connect,
no signature, read-only.

- `/card/<wallet>`: portfolio card (all Friends) plus a list of each Friend
- `/card/<wallet>/<id>`: single Friend card (`gen-<id>` picks the Generations Friend when a wallet holds both #id)
- `/card/<wallet>/og`, `/card/<wallet>/<id>/og`: 1200x630 PNGs, rendered with `next/og` (satori)
- `/memes`: the Meme Machine. Pick one of your Friends and it becomes the face of 20 classic templates, plus three
  drawn in code (Classic, Deal with it, Holo card). Its real on-chain artwork is placed on every face slot.

rarefriends.com's own portfolio page links here: its **Share** button opens `/card/<your wallet>`.

## Data

`https://rarefriends.com/api/protocol/state?address=...` (public, read-only, undocumented, may change). Every render
reads it fresh and stamps the block it was read at on the card. The PNG is CDN-cached for two minutes for link
previews; pages embed it with a block-keyed URL so the strip and the card always agree.

Every derived number is one of rarefriends.com's own formulas: Your APR = the current active stream divided by the RF
you paid to activate, annualized; Pending = (stream remaining + pending) x your share of active weight; a Friend's
pending = the same with the Friend's own share. Their formulas change without notice (the APR numerator lost pending
fees on 2026-09-20), so re-check them against <https://github.com/spokesz/rarefriends-web-public> before trusting a
difference.

## Run it

```sh
npm ci
npm run dev          # http://localhost:3000
npm run build && npm start
```

Stack: Next.js 15, React 19, `next/og` for the PNGs. FriendSDK is not used. Set `NEXT_PUBLIC_SITE_URL` if the
production domain changes.

## Credits

- **Fonts:** Silkscreen (Jason Kottke) and Sometype Mono (Dharma Type), SIL Open Font License 1.1, bundled in
  `assets/fonts` (see `assets/fonts/LICENSE.txt`).
- **Friend artwork** is each NFT's own on-chain SVG, read from rarefriends.com and rendered unmodified.
- **Meme templates** in `public/memes/` are widely circulated internet meme images, sourced via imgflip.com. They are
  not ours; all rights belong to their original creators. They are used only as backgrounds for holders' own memes:
  Drake, Distracted boyfriend, Two buttons, Change my mind, Expanding brain, Gru's plan, Once again asking (Bernie),
  Is this a pigeon?, Panik/kalm/panik, Buff doge vs cheems, Trade offer, Always has been, This is fine, Surprised
  Pikachu, Woman yelling at cat, Hide the pain Harold, Draw 25, Tuxedo Pooh, Monkey puppet, Left exit 12.

## Licence

MIT for the code in this repository. The meme template images and the fonts keep their own terms, above.
