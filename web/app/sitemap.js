import engineRelease from "../src/lib/engine-release.json";
import { SITE_URL, guideBase, guides } from "../src/lib/seo-guides";

export default function sitemap() {
  const lastModified = engineRelease?.release?.publishedAt
    ? new Date(engineRelease.release.publishedAt)
    : new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1.0 },
    { url: `${SITE_URL}${guideBase}`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE_URL}/local-engine`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    ...guides.map(({ slug }) => ({
      url: `${SITE_URL}${guideBase}/${slug}`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.85,
    })),
    { url: `${SITE_URL}/plans`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/help`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
