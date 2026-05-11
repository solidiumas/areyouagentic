import { NextResponse, type NextRequest } from 'next/server';

/**
 * Mint or pass through an `x-request-id` for every request. Server Components
 * read the header via `next/headers` and pass it into outbound fetches so the
 * API receives the same id back, joining the three apps' logs end-to-end.
 *
 * The header is also written onto the response so a browser can quote it when
 * reporting an issue.
 */
const REQ_ID = 'x-request-id';

export function middleware(req: NextRequest): NextResponse {
  const incoming = req.headers.get(REQ_ID);
  const id = incoming && incoming.length > 0 && incoming.length <= 128
    ? incoming
    : crypto.randomUUID();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(REQ_ID, id);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(REQ_ID, id);
  return res;
}

export const config = {
  // Skip Next-internals and static assets so we don't burn cycles on them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|llms.txt).*)'],
};
