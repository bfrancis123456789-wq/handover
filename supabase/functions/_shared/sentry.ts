// Error monitoring for Edge Functions. Does nothing unless SENTRY_DSN is set.
// Never sends request headers, bodies or message text: only the error, the
// function name and a stack trace.
import * as Sentry from "npm:@sentry/deno@10.77.1";

const dsn = Deno.env.get("SENTRY_DSN");

if (dsn) {
  Sentry.init({
    dsn,
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
    defaultIntegrations: false,
    sendDefaultPii: false,
    // Each call is recorded with its outcome, so Sentry can alert on failure rate.
    tracesSampleRate: Number(Deno.env.get("SENTRY_TRACES_SAMPLE_RATE") ?? 1),
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
}

export async function report(error: unknown, fn: string, extra: Record<string, string | number> = {}) {
  console.error(`[${fn}]`, error);
  if (!dsn) return;
  Sentry.withScope((scope) => {
    scope.setTag("function", fn);
    for (const [k, v] of Object.entries(extra)) scope.setExtra(k, v);
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
  await Sentry.flush(2000);
}

// Deno.serve with a safety net: anything thrown is reported and answered with a
// plain 500, instead of a bare crash.
export function serve(fn: string, handler: (req: Request) => Promise<Response>) {
  const run = async (req: Request) => {
    if (!dsn || req.method === "OPTIONS") return await handler(req);
    // One transaction per call: status "internal_error" for 5xx answers.
    return await Sentry.startSpan({ name: fn, op: "function", forceTransaction: true }, async (span) => {
      const res = await handler(req);
      span.setAttribute("http.response.status_code", res.status);
      span.setStatus(res.status >= 500 ? { code: 2, message: "internal_error" } : { code: 1 });
      return res;
    });
  };
  Deno.serve(async (req) => {
    try {
      const res = await run(req);
      if (dsn) await Sentry.flush(2000);
      return res;
    } catch (error) {
      await report(error, fn);
      return new Response(JSON.stringify({ error: "Something went wrong. Try again in a moment." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  });
}
