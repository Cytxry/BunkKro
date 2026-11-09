// Supabase Edge Function: delete-account. Deletes the CALLER's data and then their login.
//
// Deploy (owner, once):  supabase functions deploy delete-account --project-ref mvlyeygitnnuksuxmcsy
// The service-role key is provided to the function by Supabase itself (SUPABASE_SERVICE_ROLE_KEY): it never leaves
// the server and is never in the website.
//
// Safety:
//   * the caller is identified only from their own access token (Authorization: Bearer ...), verified by Supabase;
//     no user id is ever taken from the request body;
//   * the body must be {"confirm": "DELETE"} (the website asks the student to type it);
//   * every delete is filtered by that verified user id; children before parents;
//   * if ANY table fails, the login is NOT deleted and the failed tables are reported (nothing half-done is hidden);
//   * the answer says what happened, without personal data; nothing is logged but the outcome.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const ORIGINS = new Set(["https://bunkkro.vercel.app", "http://localhost:5520", "http://localhost:5530",
  "http://127.0.0.1:5520", "http://localhost:5500", "http://127.0.0.1:5500"]);
const TABLES = ["timetable_feedback", "timetable_imports", "daily_period_logs", "tracker_logs",
  "timetable_exceptions", "timetable_entries", "timetables", "subjects"];

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (ORIGINS.has(origin) || /^https:\/\/bunkkro-[a-z0-9-]+\.vercel\.app$/.test(origin));
  return ok ? { "Access-Control-Allow-Origin": origin!, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
                "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" } : {};
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get("Origin")), "Content-Type": "application/json" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { ok: false, error: "use POST" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { ok: false, error: "not signed in" });
  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (body.confirm !== "DELETE") return reply(400, { ok: false, error: "type DELETE to confirm" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return reply(401, { ok: false, error: "your session has expired; sign in again" });
  const uid = who.user.id;

  const failed: string[] = [];
  for (const t of TABLES) {
    const { error } = await admin.from(t).delete().eq("user_id", uid);
    if (error && !/42P01|PGRST20[25]/.test(error.code || "")) failed.push(t);   // a missing table is nothing to delete
  }
  if (failed.length) {
    console.log(JSON.stringify({ fn: "delete-account", outcome: "data_delete_failed", tables: failed }));
    return reply(500, { ok: false, error: "some data could not be deleted; your account was kept", failed });
  }
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    console.log(JSON.stringify({ fn: "delete-account", outcome: "auth_delete_failed" }));
    return reply(500, { ok: false, error: "your data is deleted, but the login could not be; please try again" });
  }
  console.log(JSON.stringify({ fn: "delete-account", outcome: "deleted" }));
  return reply(200, { ok: true });
});
