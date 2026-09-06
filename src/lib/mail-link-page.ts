import { NextResponse } from "next/server";

/**
 * The page a link in an email lands on.
 *
 * Deliberately standalone rather than rendered through the app's layout:
 * these have to work for somebody who is not signed in, in whatever client
 * opened the link, and the fewer moving parts between them and "it worked"
 * the better. Colours are the theme's own, inlined, because there is no
 * stylesheet on this response — which is also why they are resolved here from
 * the same values globals.css carries rather than left to drift a third time.
 *
 * Shared by the digest unsubscribe and both newsletter routes. It was copied
 * once already and the copy still carried the palette from before the
 * rebrand, which is the argument for it living in one place.
 */
export function mailLinkPage(title: string, body: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · MarketMiner</title>
<style>
  :root { color-scheme: light dark; --bg:#f5f6fb; --fg:#10111a; --muted:#5c5f70; --border:#dcdee9; --accent:#3c4bd6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#090a10; --fg:#eef0f8; --muted:#999eb3; --border:#2a2d3a; --accent:#8490fa; }
  }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--fg); padding:24px;
         font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:34rem; border:1px solid var(--border); border-radius:16px; padding:32px; }
  h1 { margin:0 0 12px; font-size:1.5rem; font-weight:600; letter-spacing:-0.01em; }
  p { margin:0 0 20px; color:var(--muted); }
  a { color:var(--accent); }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(body)}</p>
  <p><a href="/">Back to MarketMiner</a></p>
</main>
</body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
