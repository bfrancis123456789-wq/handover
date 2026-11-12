// Resets the sales demo workspace: (re)creates the five public demo accounts
// with the shared demo password, then wipes and reseeds "Harbour Hotel (Demo)".
// Only the service role (npm run demo:reset) or a Handover admin signed in with
// two-factor can call it. It never touches any other workplace or account.
//
// Deploy:  supabase functions deploy reset-demo
// Secret:  supabase secrets set DEMO_PASSWORD=...   (optional; it's shared with prospects)
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkOrigin, jsonFor } from "../_shared/cors.ts";
import { report, serve } from "../_shared/sentry.ts";

export const DEMO_ACCOUNTS = [
  { key: "manager", email: "demo.manager@demo.handover.test", name: "Ana Okafor" },
  { key: "supervisor", email: "demo.supervisor@demo.handover.test", name: "Tom Reyes" },
  { key: "staff", email: "demo.staff1@demo.handover.test", name: "Priya Shah" },
  { key: "staff", email: "demo.staff2@demo.handover.test", name: "Liam Walsh" },
  { key: "staff", email: "demo.staff3@demo.handover.test", name: "Kofi Mensah" },
];

serve("reset-demo", async (req) => {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  const json = jsonFor(req);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  // Who may reset: the service role, or a platform admin with two-factor sign-in.
  if (token !== serviceKey) {
    if (!token) return json({ error: "Sign in as a Handover admin to reset the demo." }, 401);
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: status } = await asUser.rpc("my_admin_status");
    if (!status?.admin || !status?.mfa) return json({ error: "Only Handover admins signed in with two-factor can reset the demo." }, 403);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const password = Deno.env.get("DEMO_PASSWORD") ?? "HandoverDemo-2026";

  const { data: existing, error: listError } = await admin.rpc("demo_account_ids");
  if (listError) {
    await report(listError, "reset-demo", { step: "list" });
    return json({ error: "The demo could not be reset. Try again in a moment." }, 500);
  }
  const ids = new Map((existing ?? []).map((r: { email: string; user_id: string }) => [r.email, r.user_id]));

  const users: { manager?: string; supervisor?: string; staff: string[] } = { staff: [] };
  for (const acc of DEMO_ACCOUNTS) {
    const metadata = { full_name: acc.name, terms_accepted_at: new Date().toISOString(), terms_version: "demo" };
    let id = ids.get(acc.email) as string | undefined;
    if (id) {
      const { error } = await admin.auth.admin.updateUserById(id, { password, user_metadata: metadata, ban_duration: "none" });
      if (error) { await report(error, "reset-demo", { step: "update_user" }); return json({ error: "The demo accounts could not be reset." }, 500); }
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email: acc.email, password, email_confirm: true, user_metadata: metadata });
      if (error || !data.user) { await report(error, "reset-demo", { step: "create_user" }); return json({ error: "The demo accounts could not be created." }, 500); }
      id = data.user.id;
    }
    if (acc.key === "staff") users.staff.push(id);
    else users[acc.key as "manager" | "supervisor"] = id;
  }

  const { data: seeded, error: seedError } = await admin.rpc("seed_demo_workspace", { p_users: users });
  if (seedError) {
    await report(seedError, "reset-demo", { step: "seed" });
    return json({ error: "The demo data could not be created. Try again in a moment." }, 500);
  }
  const { error: reportError } = await admin.rpc("seed_demo_reports", { p_supervisor: users.supervisor });
  if (reportError) await report(reportError, "reset-demo", { step: "seed_reports" });

  return json({ reset: true, messages: seeded?.messages ?? 0, accounts: DEMO_ACCOUNTS.map((a) => a.email), password });
});
