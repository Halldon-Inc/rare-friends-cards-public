"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** External-link arrow drawn as an icon, so it never falls back to a different font than the label. */
const Arrow = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden shapeRendering="crispEdges">
    <path d="M2 1h7v7H7.5V3.6L2.8 8.3 1.7 7.2 6.4 2.5H2z" fill="currentColor" />
  </svg>
);

/** Top-bar links: four identical items, the current section underlined the way rarefriends.com marks its active tab. */
export function NavLinks() {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" || path.startsWith("/card") : path.startsWith(href));
  return (
    <div className="navlinks">
      <Link href="/" aria-current={current("/") ? "page" : undefined}>cards</Link>
      <Link href="/memes" aria-current={current("/memes") ? "page" : undefined}>memes</Link>
      <a href="https://rarefriends.com/portfolio" target="_blank" rel="noreferrer">portfolio<Arrow /></a>
      <a href="https://rarefriends.com/docs" target="_blank" rel="noreferrer">docs<Arrow /></a>
    </div>
  );
}
