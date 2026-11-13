const STORE_DOWNLOADS = "ms-windows-store://downloadsandupdates";

export function managedUpdateChannel(distribution, capabilities = {}) {
  if (!distribution?.managedUpdates && !capabilities.store_updates) return null;
  if (distribution?.channel === "msix" || capabilities.store_updates) {
    const candidate = distribution?.updateUrl;
    return {
      channel: "msix",
      url: typeof candidate === "string" && /^ms-windows-store:\/\/pdp\/\?ProductId=[A-Z0-9]{12}$/.test(candidate) ? candidate : STORE_DOWNLOADS,
    };
  }
  return { channel: "unknown", url: null };
}
