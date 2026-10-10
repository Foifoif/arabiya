import { afterEach, expect, test, vi } from "vitest";
import { onRequest, type Env } from "./cloud-server";
import { initialData } from "./model";
const env: Env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", MEMORY_EMAIL: "aliafsh.3@gmail.com" };
const allowed = { id: "11111111-1111-4111-8111-111111111111", email: env.MEMORY_EMAIL, email_confirmed_at: "2026-10-10T00:00:00Z", aud: "authenticated", role: "authenticated" };
const head = { version: 0, data: null, updatedAt: null, mutationId: null };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function request(path = "state", init: RequestInit = {}) {
  return new Request(`https://alisarabic.com/cloud/api/${path}`, { ...init, headers: { Authorization: "Bearer test-session", ...init.headers } });
}
function backend(user: unknown = allowed, rpcReply: unknown = head, rpcStatus = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) return user ? json(user) : json({ message: "Invalid JWT", code: "bad_jwt" }, 401);
    if (url.includes("/rest/v1/rpc/")) return json(rpcReply, rpcStatus);
    throw new Error(`Unexpected request: ${url}`);
  }));
  return calls;
}
const run = (req = request(), settings = env) => onRequest({ request: req, env: settings });
afterEach(() => vi.unstubAllGlobals());

test("only public configuration is exposed; secret keys and missing config fail closed", async () => {
  const req = new Request("https://alisarabic.com/cloud/config");
  expect(await (await run(req)).json()).toEqual({ url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
  for (const settings of [{}, { ...env, SUPABASE_PUBLISHABLE_KEY: "sb_secret_do-not-expose" }]) {
    const result = await run(req, settings);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("sb_secret");
  }
});

test("anonymous, forged, wrong-account and unconfirmed sessions cannot reach database RPCs", async () => {
  let calls = backend();
  expect((await run(new Request("https://alisarabic.com/cloud/api/state"))).status).toBe(401);
  expect(calls).toHaveLength(0);
  for (const user of [null, { ...allowed, email: "someone@example.com" }, { ...allowed, email_confirmed_at: null }]) {
    calls = backend(user);
    expect([401, 403]).toContain((await run()).status);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/auth/v1/user");
  }
});

test("verified session token is forwarded to owner-checking Supabase RPC", async () => {
  const calls = backend();
  expect(await (await run()).json()).toEqual({ email: env.MEMORY_EMAIL, head });
  expect(calls[1].url).toContain("/rpc/memory_state");
  expect(new Headers(calls[1].init?.headers).get("Authorization")).toBe("Bearer test-session");
  expect(new Headers(calls[1].init?.headers).get("apikey")).toBe(env.SUPABASE_PUBLISHABLE_KEY);
});

test("validated writes preserve compare-and-swap arguments; invalid input never reaches database", async () => {
  const data = initialData();
  const mutationId = crypto.randomUUID();
  let calls = backend(allowed, { ...head, version: 1, data });
  const put = (body: unknown, origin = "https://alisarabic.com") => request("state", {
    method: "PUT", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  expect((await run(put({ expectedVersion: 0, mutationId, data }))).status).toBe(200);
  expect(calls[1].url).toContain("/rpc/memory_save");
  expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({ expected_version: 0, mutation_id: mutationId, collection: { version: 2, round: null } });
  calls = backend();
  expect((await run(put({}))).status).toBe(400);
  expect((await run(put({ expectedVersion: 0, mutationId, data }, "https://other.example"))).status).toBe(403);
  expect(calls.every(call => call.url.endsWith("/auth/v1/user"))).toBe(true);
});

test("database errors keep their conflict, permission and recovery meaning", async () => {
  for (const [code, status] of [["PT409", 409], ["PT404", 404], ["PT400", 400], ["42501", 403], ["XX000", 503]] as const) {
    backend(allowed, { code, message: "Internal implementation detail" }, 400);
    const response = await run();
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("Internal implementation detail");
  }
});
