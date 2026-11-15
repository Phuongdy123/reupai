import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { GUEST_WORKSPACE_ROUTES } from "../workspace-routes.mjs";

const publicRoutes = new Set(["/", ...GUEST_WORKSPACE_ROUTES, "/sign-in", "/sign-up", "/plans", "/terms", "/privacy"]);

function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export async function updateSession(request) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/terms" || pathname === "/privacy" || pathname === "/local-engine" || pathname.startsWith("/giai-phap")) {
    return NextResponse.next({ request });
  }
  if (!configured()) {
    if (publicRoutes.has(pathname) || pathname === "/pending" || pathname.startsWith("/auth/")) {
      return NextResponse.next({ request });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const isPublic = publicRoutes.has(pathname) || pathname.startsWith("/auth/");
  const hasAuthCookie = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"));
  if (!hasAuthCookie) {
    if (isPublic || pathname === "/pending") {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-reupai-guest", "1");
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  let user = null;
  try { const result = await supabase.auth.getUser(); user = result.data?.user || null; }
  catch { /* Public pages still render as a guest if account services are unavailable. */ }
  if (!user) {
    if (isPublic || pathname === "/pending") {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-reupai-guest", "1");
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const cachedOk = request.cookies.get("reupai_profile_ok")?.value === `1:${user.id}`;
  const needsFreshProfile = !cachedOk || pathname.startsWith("/admin/") || pathname === "/pending";
  let profile = null;
  if (needsFreshProfile) {
    const { data } = await supabase.from("profiles").select("status, role").eq("id", user.id).maybeSingle();
    profile = data;
    const status = profile?.status || "pending";
    if (status !== "approved") {
      if (pathname === "/pending" || pathname === "/plans" || pathname.startsWith("/auth/")) return response;
      const url = request.nextUrl.clone(); url.pathname = "/pending"; url.search = "";
      return NextResponse.redirect(url);
    }
    response.cookies.set("reupai_profile_ok", `1:${user.id}`, { path: "/", maxAge: 120, httpOnly: true, sameSite: "lax" });
  }

  if (pathname === "/pending" || pathname === "/sign-in" || pathname === "/sign-up" || pathname === "/") {
    const url = request.nextUrl.clone(); url.pathname = "/app"; url.search = "";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin/") && profile?.role !== "admin") {
    const url = request.nextUrl.clone(); url.pathname = "/app"; url.search = "";
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-reupai-user-id", user.id);
  const nextResponse = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.getAll().forEach((cookie) => nextResponse.cookies.set(cookie));
  return nextResponse;
}
