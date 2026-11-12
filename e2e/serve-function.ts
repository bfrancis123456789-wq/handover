// Runs one Edge Function file with plain Deno on a chosen port, for local tests
// and CI (the Supabase edge runtime isn't needed for that).
//   FN_PORT=8000 FN_FILE=file:///.../supabase/functions/shift-brief/index.ts deno run -A e2e/serve-function.ts
const port = Number(Deno.env.get("FN_PORT") ?? 8000);
const orig = Deno.serve.bind(Deno);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler: any) => orig({ port, hostname: "0.0.0.0" }, handler);
await import(Deno.env.get("FN_FILE")!);
