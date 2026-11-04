import { guideBase, guides } from "../src/lib/seo-guides";

export default function sitemap() {
  const base = "https://www.reupai.cloud";
  const paths = ["/", guideBase, ...guides.map(({ slug }) => `${guideBase}/${slug}`), "/plans", "/terms", "/privacy"];
  return paths.map((path) => ({ url: `${base}${path}` }));
}
