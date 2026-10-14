import { updateSession } from "./src/lib/supabase/middleware";

export async function middleware(request) {
  return updateSession(request);
}

export const config = { matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"] };
