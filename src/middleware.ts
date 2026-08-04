import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Restore the last-viewed budget month from the session cookie so navigating
  // away and back doesn't silently reset to the current month. The cookie is
  // session-scoped (no Max-Age), so closing the browser clears it and the next
  // login always opens to the current month.
  if (pathname === "/budget" && !searchParams.has("month")) {
    const saved = request.cookies.get("budget-month")?.value;
    if (saved && /^\d{4}-\d{2}$/.test(saved)) {
      const url = request.nextUrl.clone();
      url.searchParams.set("month", saved);
      return NextResponse.redirect(url);
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
