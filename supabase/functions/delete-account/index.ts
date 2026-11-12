// Deletes the signed-in person's account (Australian Privacy Principle 11.2).
//
// Order matters:
//   1. Leave the workplace as the user, so the database's own rules apply:
//      the only manager can't leave while others remain (nothing is deleted then),
//      and a workplace with nobody left in it is removed.
//   2. Optionally delete the messages and photos they posted.
//   3. Delete their profile photo files and their login. Their profile, likes,
//      briefs, devices and read markers go with it; messages they keep show
//      as "Former member".
//
// Deploy: supabase functions deploy delete-account
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkOrigin, jsonFor } from "../_shared/cors.ts";
import { report, serve } from "../_shared/sentry.ts";

serve("delete-account", async (req) => {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  const json = jsonFor(req);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Sign in to delete your account." }, 401);

  let deleteMessages = false;
  try {
    deleteMessages = (await req.json())?.delete_messages === true;
  } catch { /* no body: keep messages */ }

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return json({ error: "Your session has expired. Sign in again." }, 401);
  const userId = userData.user.id;

  // 1. Leave the workplace first, as the user.
  const { data: profile } = await asUser.from("profiles").select("workplace_id").eq("id", userId).maybeSingle();
  if (profile?.workplace_id) {
    const { error: leaveError } = await asUser.rpc("leave_workplace");
    if (leaveError) {
      const onlyManager = /only manager/i.test(leaveError.message);
      return json({
        error: onlyManager
          ? "You are the only manager. Make someone else a manager in Manage Team before you delete your account."
          : "Your account could not be deleted. Try again in a moment.",
      }, onlyManager ? 409 : 500);
    }
  }

  // 2. Messages and photos, if they asked.
  if (deleteMessages) {
    const { data: withPhotos } = await admin.from("messages").select("image_url").eq("author_id", userId).not("image_url", "is", null);
    const paths = (withPhotos ?? []).map((m: { image_url: string }) => m.image_url);
    for (let i = 0; i < paths.length; i += 100) {
      await admin.storage.from("message-images").remove(paths.slice(i, i + 100));
    }
    const { error: msgError } = await admin.from("messages").delete().eq("author_id", userId);
    if (msgError) {
      await report(msgError, "delete-account", { step: "messages" });
      return json({ error: "Your messages could not be deleted. Try again in a moment." }, 500);
    }
  }

  // 3. Profile photos, then the login itself.
  const { data: avatars } = await admin.storage.from("avatars").list(userId, { limit: 1000 });
  if (avatars?.length) await admin.storage.from("avatars").remove(avatars.map((f: { name: string }) => `${userId}/${f.name}`));

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    await report(deleteError, "delete-account", { step: "delete_user" });
    return json({ error: "Your account could not be deleted. Try again in a moment." }, 500);
  }

  return json({ deleted: true, messages_deleted: deleteMessages });
});
