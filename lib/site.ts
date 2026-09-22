export function baseUrl() {
  const v = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (!v) return "http://localhost:3000";
  return v.startsWith("http") ? v : `https://${v}`;
}
