import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/site";

// Allow everything: a Disallow under /card/ would stop Facebook's and X's crawlers fetching the share images.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${baseUrl()}/sitemap.xml` };
}
