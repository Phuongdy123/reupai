import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "./config";

export function createServerSupabaseClient() {
  const cookieStore = cookies();
  const { url, key } = requireSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values) {
        try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch (_) { /* Middleware refreshes cookies for server components. */ }
      },
    },
  });
}

export function createAdminSupabaseClient() {
  const { url } = requireSupabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) throw new Error("Quản trị tài khoản chưa được cấu hình trên server.");
  return createServiceClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
