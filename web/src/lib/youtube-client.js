import { createClient } from "./supabase/client";
export { googleConsentUrl } from "./google-consent";

export async function youtubeRequest(client, path, options = {}) {
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Hãy đăng nhập ReupAI để quản lý kênh YouTube.");
  const headers = new Headers(options.headers || {});
  headers.set("X-ReupAI-Account", data.session.access_token);
  if (options.body) headers.set("Content-Type", "application/json");
  return client.json(`/api/youtube/${path}`, { ...options, headers });
}

