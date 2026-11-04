import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

const publicRoutes = new Set(["/", "/sign-in", "/sign-up", "/plans", "/terms", "/privacy"]);

function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export async function updateSession(request) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/terms" || pathname === "/privacy" || pathname.startsWith("/giai-phap")) {
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
  const { data: { user } } = await supabase.auth.getUser();
  const isPublic = publicRoutes.has(pathname) || pathname.startsWith("/auth/");
  if (!user) {
    if (isPublic || pathname === "/pending") return response;
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  const { data: profile } = await supabase.from("profiles").select("status, role").eq("id", user.id).maybeSingle();
  const status = profile?.status || "pending";
  if (status !== "approved") {
    if (pathname === "/pending" || pathname === "/plans" || pathname.startsWith("/auth/")) return response;
    const url = request.nextUrl.clone(); url.pathname = "/pending"; url.search = "";
    return NextResponse.redirect(url);
  }
  if (pathname === "/pending" || pathname === "/sign-in" || pathname === "/sign-up" || pathname === "/") {
    const url = request.nextUrl.clone(); url.pathname = "/app"; url.search = "";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin/") && profile?.role !== "admin") {
    const url = request.nextUrl.clone(); url.pathname = "/app"; url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
