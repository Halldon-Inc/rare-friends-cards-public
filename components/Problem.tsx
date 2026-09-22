import Link from "next/link";
export function Problem({ title, body }: { title: string; body: string }) {
  return (
    <main className="wrap">
      <header className="pagehead"><h1 className="px">{title}</h1></header>
      <p className="empty">{body}</p>
      <p className="foot"><Link className="btn" href="/">[ try another wallet ]</Link></p>
    </main>
  );
}
