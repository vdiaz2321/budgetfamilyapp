import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // This middleware exists to keep the session cookies fresh, and it runs on
  // EVERY request. `getUser()` did that by asking the auth server who the user
  // is — a real network round trip, 300ms typically and up to a second on a
  // bad connection, in front of every page in the app.
  //
  // `getClaims()` does the same job without the trip: this project signs its
  // JWTs with an asymmetric key (ES256, published at /auth/v1/.well-known/
  // jwks.json), so the token is verified locally with WebCrypto against a
  // cached copy of that key set. It still refreshes the session — and writes
  // the new cookies through `setAll` above — when the access token is near
  // expiry, which is the only reason this call is here.
  //
  // Two things this depends on, worth knowing if it ever regresses: the
  // project must keep asymmetric signing keys (with a symmetric secret,
  // getClaims falls back to a server round trip and the saving disappears),
  // and the runtime must have WebCrypto (Edge does).
  try {
    await supabase.auth.getClaims();
  } catch {
    // Never let a verification hiccup take down every route. Falling back to
    // the auth server costs the round trip we're avoiding, but it's the
    // behaviour this middleware had before and it keeps the app up.
    await supabase.auth.getUser();
  }

  return response;
}
