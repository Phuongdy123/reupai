export default function robots() {
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/giai-phap", "/plans", "/terms", "/privacy", "/images/"],
      disallow: ["/api/", "/app", "/admin", "/auth/", "/collections", "/downloads", "/favorites", "/history", "/local-engine", "/outputs", "/series", "/settings", "/sources"],
    }],
    sitemap: "https://www.reupai.cloud/sitemap.xml",
    host: "https://www.reupai.cloud",
  };
}
