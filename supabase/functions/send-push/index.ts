// Sends Web Push notifications for a new message.
// Called by the messages_notify_push database trigger (see the push migration),
// never by the browser. It authenticates the trigger with a shared secret and
// uses the service role to look up who should be notified.
//
// Deploy:   supabase functions deploy send-push --no-verify-jwt
// Secrets:  supabase secrets set PUSH_WEBHOOK_SECRET=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
import webpush from "npm:web-push@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { report, serve } from "../_shared/sentry.ts";

const CHANNEL_LABELS: Record<string, string> = {
  general: "General",
  announcements: "Announcements",
  team_member: "Team Member",
  supervisors: "Supervisors",
  management: "Management",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve("send-push", async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  if (!secret || !sameSecret(req.headers.get("x-push-secret") ?? "", secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@handover.app";
  if (!publicKey || !privateKey) return json({ error: "VAPID keys are not configured" }, 500);

  let messageId: string;
  try {
    messageId = (await req.json()).message_id;
  } catch {
    return json({ error: "Expected JSON with message_id" }, 400);
  }
  if (!messageId) return json({ error: "Expected JSON with message_id" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const [{ data: message }, { data: recipients, error: recipientsError }] = await Promise.all([
    admin
      .from("messages")
      .select("id, channel, content, image_url, author:profiles!messages_author_id_fkey(display_name), workplace:workplaces(name)")
      .eq("id", messageId)
      .maybeSingle(),
    admin.rpc("push_recipients", { p_message: messageId }),
  ]);
  if (!message) return json({ sent: 0, reason: "message not found" });
  if (recipientsError) {
    await report(recipientsError, "send-push", { step: "push_recipients" });
    return json({ error: "Could not load recipients" }, 500);
  }
  if (!recipients?.length) return json({ sent: 0 });

  // deno-lint-ignore no-explicit-any
  const m = message as any;
  const channelLabel = CHANNEL_LABELS[m.channel] ?? m.channel;
  const text = (m.content ?? "").trim().replace(/\s+/g, " ");
  const payload = JSON.stringify({
    title: `${m.author?.display_name ?? "Someone"} in ${channelLabel}`,
    body: text ? (text.length > 140 ? text.slice(0, 139) + "…" : text) : "Sent a photo",
    url: `/channels/${m.channel}`,
    tag: `channel-${m.channel}`,
    workplace: m.workplace?.name ?? null,
  });

  const results = await Promise.allSettled(
    recipients.map(async (r: { subscription_id: string; endpoint: string; p256dh: string; auth: string }) => {
      let details;
      try {
        details = webpush.generateRequestDetails(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          payload,
          { vapidDetails: { subject, publicKey, privateKey }, TTL: 60 * 60 * 12, urgency: "normal", topic: `channel-${m.channel}` },
        );
      } catch (err) {
        // Keys that can't be used will never work: treat the device as gone.
        console.warn("unusable subscription keys", err instanceof Error ? err.message : err);
        return { id: r.subscription_id, status: 410 };
      }
      const res = await fetch(details.endpoint, { method: "POST", headers: details.headers, body: details.body });
      await res.body?.cancel();
      return { id: r.subscription_id, status: res.status };
    }),
  );

  // Devices that unsubscribed or expired answer 404 or 410: forget them.
  const gone: string[] = [];
  let sent = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.status === 404 || r.value.status === 410) gone.push(r.value.id);
      else if (r.value.status < 300) sent++;
      else await report(new Error(`Push service rejected a notification (HTTP ${r.value.status})`), "send-push", { status: r.value.status });
    } else {
      await report(r.reason, "send-push", { step: "deliver" });
    }
  }
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);

  return json({ sent, removed: gone.length, total: recipients.length });
});
