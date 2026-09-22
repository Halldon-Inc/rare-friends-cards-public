// X reads twitter:image before og:image; serve the same static composition under both names.
export { default, alt, size, contentType } from "./opengraph-image";
export const runtime = "nodejs";
export const dynamic = "force-static";
