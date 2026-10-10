import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateData } from "./model";
import { cloudData } from "./cloud-model";

export type Env = { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; MEMORY_EMAIL?: string };
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers }); }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function configuration(env: Env) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL || "") ||
      !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY || "") || !env.MEMORY_EMAIL)
    throw new HttpError(503, "Cloud saving is not configured yet.");
  // Never expose a service-role or secret key, even if configured by mistake.
  return { url: env.SUPABASE_URL!, publishableKey: env.SUPABASE_PUBLISHABLE_KEY! };
}
export async function authenticate(request: Request, env: Env) {
  const config = configuration(env);
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer [^\s]{1,16000}$/.test(authorization)) throw new HttpError(401, "Sign in to access your collection.");
  const token = authorization.slice(7);
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization },
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  });
  // getUser validates with Supabase Auth. Decoded client JWT claims are never
  // treated as proof of identity. The database independently checks ownership.
  const { data, error } = await client.auth.getUser(token);
  if (error) throw new HttpError(error.status && error.status >= 500 ? 503 : 401, "Sign in again to access cloud saving.");
  if (!data.user?.email_confirmed_at || data.user.email?.toLowerCase() !== env.MEMORY_EMAIL!.toLowerCase())
    throw new HttpError(403, "This account is not allowed to access the collection.");
  return { client, email: data.user.email.toLowerCase() };
}
async function rpc(client: SupabaseClient, name: string, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const code = error.code === "PT409" ? 409 : error.code === "PT404" ? 404 : error.code === "PT400" ? 400 : error.code === "42501" ? 403 : 503;
    const message = code === 409 ? "Another device saved changes first. Both collections have been kept; choose which to continue with."
      : code === 404 ? "This version is no longer available."
      : code === 403 ? "This account is not allowed to access the collection."
      : code === 400 ? "Invalid collection. Your existing cloud save was not changed."
      : "Cloud saving is temporarily unavailable. Your changes remain on this device.";
    throw new HttpError(code, message);
  }
  return data;
}
export async function handleApi(request: Request, client: SupabaseClient, email: string) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/cloud\/api\//, "");
  if (request.method === "GET" && route === "state") return json({ email, head: await rpc(client, "memory_state") });
  if (request.method === "GET" && route === "versions") return json({ versions: await rpc(client, "memory_versions") });
  if (request.method === "GET" && /^versions\/\d+$/.test(route))
    return json({ data: await rpc(client, "memory_version", { requested_version: Number(route.split("/")[1]) }) });
  if (request.method === "PUT" && route === "state") {
    if (request.headers.get("Origin") !== url.origin || !request.headers.get("Content-Type")?.startsWith("application/json"))
      return json({ error: "Invalid save request." }, 403);
    if (Number(request.headers.get("Content-Length")) > 4000000) return json({ error: "Collection exceeds the 4 MB cloud-save limit. Export a backup before reducing it." }, 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4000000) return json({ error: "Collection exceeds the 4 MB cloud-save limit. Local changes are preserved." }, 413);
    let body;
    try {
      body = JSON.parse(text);
      if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || !/^[a-zA-Z0-9-]{16,80}$/.test(body.mutationId)) throw new Error();
      body.data = cloudData(validateData(body.data));
    } catch { return json({ error: "Invalid collection. Your existing cloud save was not changed." }, 400); }
    return json({ head: await rpc(client, "memory_save", { expected_version: body.expectedVersion, mutation_id: body.mutationId, collection: body.data }) });
  }
  return json({ error: "Not found." }, 404);
}
export async function onRequest({ request, env }: { request: Request; env: Env }) {
  try {
    if (request.method === "GET" && new URL(request.url).pathname === "/cloud/config") return json(configuration(env));
    const { client, email } = await authenticate(request, env);
    return await handleApi(request, client, email);
  } catch (e) {
    return json({ error: e instanceof HttpError ? e.message : "Cloud saving is temporarily unavailable. Your changes remain on this device." }, e instanceof HttpError ? e.status : 503);
  }
}
