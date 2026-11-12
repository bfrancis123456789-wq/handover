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
    tracesSampleRate: 0,
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
  Deno.serve(async (req) => {
    try {
      return await handler(req);
    } catch (error) {
      await report(error, fn);
      return new Response(JSON.stringify({ error: "Something went wrong. Try again in a moment." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  });
}
