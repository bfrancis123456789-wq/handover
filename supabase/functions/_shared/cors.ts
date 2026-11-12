// CORS for Edge Functions called from the browser.
// Only origins listed in ALLOWED_ORIGINS (comma-separated, e.g.
// "https://app.handover.example") may call them. If it isn't set, only local
// development addresses are allowed, so a missing setting fails closed.
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function allowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) return DEV_ORIGINS;
  return configured.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
}

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  const origin = req.headers.get("Origin");
  if (origin && allowedOrigins().includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// Answers preflight requests, and refuses requests from browser pages on other
// sites. Requests without an Origin header (server-to-server) are not affected.
export function checkOrigin(req: Request): Response | null {
  const origin = req.headers.get("Origin");
  const allowed = !origin || allowedOrigins().includes(origin);
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
