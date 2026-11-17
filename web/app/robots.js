import { SITE_URL } from "../src/lib/seo-guides";

export default function robots() {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/giai-phap", "/local-engine", "/plans", "/terms", "/privacy", "/images/"],
      disallow: [
        "/api/", "/app", "/admin", "/auth/", "/collections", "/downloads",
        "/favorites", "/feedback", "/help", "/history", "/local-engine/callback",
        "/outputs", "/pending", "/profile", "/series", "/settings",
        "/sign-in", "/sign-up", "/sources", "/studio/",
      ],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
