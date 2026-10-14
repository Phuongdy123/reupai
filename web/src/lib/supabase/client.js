import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseConfig } from "./config";

let browserClient;

export function createClient() {
  if (!browserClient) {
    const { url, key } = requireSupabaseConfig();
    browserClient = createBrowserClient(url, key);
  }
  return browserClient;
}
