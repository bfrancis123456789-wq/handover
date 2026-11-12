// deno test supabase/functions/_shared/cors_test.ts
import { isAllowedOrigin } from "./cors.ts";

const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

Deno.test("exact origins", () => {
  const allowed = ["https://app.handover.com.au"];
  assert(isAllowedOrigin("https://app.handover.com.au", allowed), "exact match allowed");
  assert(!isAllowedOrigin("https://evil.example", allowed), "other site refused");
  assert(!isAllowedOrigin("https://app.handover.com.au.evil.example", allowed), "suffix trick refused");
  assert(!isAllowedOrigin("http://app.handover.com.au", allowed), "http refused");
});

Deno.test("preview wildcard", () => {
  const allowed = ["https://*.handover.pages.dev"];
  assert(isAllowedOrigin("https://pr-12.handover.pages.dev", allowed), "preview allowed");
  assert(isAllowedOrigin("https://staging.handover.pages.dev", allowed), "staging allowed");
  assert(!isAllowedOrigin("https://handover.pages.dev", allowed), "bare domain needs its own entry");
  assert(!isAllowedOrigin("https://a.b.handover.pages.dev", allowed), "only one subdomain level");
  assert(!isAllowedOrigin("https://evilhandover.pages.dev", allowed), "lookalike refused");
  assert(!isAllowedOrigin("https://pr-12.handover.pages.dev.evil.example", allowed), "suffix trick refused");
  assert(!isAllowedOrigin("http://pr-12.handover.pages.dev", allowed), "http refused");
});
