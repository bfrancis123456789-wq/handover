// CORS for Edge Functions called from the browser.
// Only origins listed in ALLOWED_ORIGINS (comma-separated, e.g.
// "https://app.handover.example") may call them. On staging, an entry like
// "https://*.handover.pages.dev" also allows pull request previews (one
// subdomain level, https only). If it isn't set, only local development
// addresses are allowed, so a missing setting fails closed.
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function allowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) return DEV_ORIGINS;
  return configured.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
}

export function isAllowedOrigin(origin: string, allowed = allowedOrigins()): boolean {
  return allowed.some((entry) => {
    if (entry === origin) return true;
    const wildcard = entry.match(/^https:\/\/\*\.([a-z0-9.-]+)$/i);
    if (!wildcard) return false;
    const suffix = "." + wildcard[1].toLowerCase();
    if (!origin.startsWith("https://")) return false;
    const host = origin.slice("https://".length).toLowerCase();
    const sub = host.slice(0, host.length - suffix.length);
    return host.endsWith(suffix) && /^[a-z0-9-]+$/.test(sub);
  });
}

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  const origin = req.headers.get("Origin");
  if (origin && isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Answers preflight requests, and refuses requests from browser pages on other
// sites. Requests without an Origin header (server-to-server) are not affected.
export function checkOrigin(req: Request): Response | null {
  const origin = req.headers.get("Origin");
  const allowed = !origin || isAllowedOrigin(origin);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: allowed ? 204 : 403, headers: corsHeaders(req) });
  }
  if (!allowed) {
    return new Response(JSON.stringify({ error: "This site is not allowed to call this service." }), {
      status: 403,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
  return null;
}

export function jsonFor(req: Request) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
}
