import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { safeAuthPath } from "../../../src/lib/auth-navigation.mjs";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeAuthPath(url.searchParams.get("next"), url.origin);
  const destination = new URL(next, url.origin);
  const failedDestination = (reason) => {
    const signIn = new URL("/sign-in", url.origin);
    signIn.searchParams.set("error", reason);
    if (next !== "/app") signIn.searchParams.set("next", next);
    return signIn;
  };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.redirect(failedDestination("account_not_configured"));
  }
  if (!code || url.searchParams.has("error")) return NextResponse.redirect(failedDestination("google_sign_in_failed"));
  const response = NextResponse.redirect(destination);
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(values) { values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
    },
  });
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      response.headers.set("location", failedDestination("google_sign_in_failed").toString());
    }
  } catch {
    response.headers.set("location", failedDestination("google_sign_in_failed").toString());
  }
  return response;
}
