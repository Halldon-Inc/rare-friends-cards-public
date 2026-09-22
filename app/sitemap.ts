import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/site";

// Card URLs are unbounded (one per wallet), so only the home page is listed.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${baseUrl()}/`, changeFrequency: "weekly", priority: 1 }];
}
