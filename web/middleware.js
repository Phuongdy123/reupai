import { updateSession } from "./src/lib/supabase/middleware";

export async function middleware(request) {
  return updateSession(request);
}

export const config = { matcher: ["/((?!api/|_next/static|_next/image|images/|favicon.ico|robots.txt|sitemap.xml|f8a9c4e2d1b74365a9c0e8f123456789.txt).*)"] };
