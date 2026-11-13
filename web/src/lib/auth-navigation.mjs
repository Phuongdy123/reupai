export function safeAuthPath(value, origin = "https://reupai.invalid") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/app";
  try {
    const destination = new URL(value, origin);
    if (destination.origin !== new URL(origin).origin || destination.pathname.startsWith("//")) return "/app";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch { return "/app"; }
}
