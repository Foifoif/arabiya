import { afterEach, beforeEach, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { initialData } from "./model";
import { cloudData } from "./cloud-model";

const migration = readFileSync(new URL("../../supabase/migrations/202610100001_cloud_save.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    insert into auth.users values ('${owner}', 'aliafsh.3@gmail.com', now()), ('${other}', 'other@example.com', now());`);
  await db.exec(migration);
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}';`);
}, 20000);
afterEach(async () => { await db?.close(); });
async function rpc(name: string, args: unknown[] = []) {
  return (await db.query<{ result: any }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result;
}
const save = (version: number, data = cloudData(initialData()), id = crypto.randomUUID()) =>
  rpc("memory_save", [version, id, JSON.stringify(data)]);

test("Postgres saves atomically, rejects stale writes, and handles lost acknowledgements", async () => {
  expect(await rpc("memory_state")).toMatchObject({ version: 0, data: null });
  const data = cloudData(initialData());
  const mutation = crypto.randomUUID();
  const head = await save(0, data, mutation);
  expect(head).toMatchObject({ version: 1, data: JSON.parse(JSON.stringify(data)), mutationId: mutation });
  expect(await save(0, data, mutation)).toEqual(head);
  await expect(save(0)).rejects.toMatchObject({ code: "PT409" });
  await expect(save(1, cloudData(initialData()), mutation)).rejects.toMatchObject({ code: "PT400" });
  expect(await rpc("memory_state")).toEqual(head);
});

test("Postgres blocks anonymous, unrelated, unconfirmed users and direct table access", async () => {
  await save(0);
  await expect(db.query("select * from memory_private.collections")).rejects.toMatchObject({ code: "42501" });
  await db.exec(`set request.jwt.claim.sub = '${other}';`);
  for (const name of ["memory_state", "memory_versions"]) await expect(rpc(name)).rejects.toMatchObject({ code: "42501" });
  await expect(rpc("memory_version", [1])).rejects.toMatchObject({ code: "42501" });
  await expect(save(0)).rejects.toMatchObject({ code: "42501" });
  await db.exec(`reset role; update auth.users set email_confirmed_at = null where id = '${owner}';
    set role authenticated; set request.jwt.claim.sub = '${owner}';`);
  await expect(rpc("memory_state")).rejects.toMatchObject({ code: "42501" });
  await db.exec("set role anon;");
  await expect(rpc("memory_state")).rejects.toMatchObject({ code: "42501" });
  await expect(save(0)).rejects.toMatchObject({ code: "42501" });
});

test("Postgres retains 50 versions and restoration makes a new version", async () => {
  const data = cloudData(initialData());
  for (let i = 0; i < 52; i++) {
    data.cards[0].front.headline = `Revision ${i + 1}`;
    await save(i, data);
  }
  const versions = await rpc("memory_versions");
  expect(versions).toHaveLength(50);
  expect(versions[0]).toMatchObject({ version: 52, cards: 5, reviews: 0 });
  await expect(rpc("memory_version", [2])).rejects.toMatchObject({ code: "PT404" });
  const earlier = await rpc("memory_version", [3]);
  expect((await save(52, earlier)).version).toBe(53);
  expect((await rpc("memory_state")).data.cards[0].front.headline).toBe("Revision 3");
  expect((await rpc("memory_version", [52])).cards[0].front.headline).toBe("Revision 52");
});

test("Postgres validates direct API writes and supports rerunning the migration", async () => {
  await expect(rpc("memory_save", [0, crypto.randomUUID(), "{}"])).rejects.toMatchObject({ code: "PT400" });
  await save(0);
  await db.exec("reset role;");
  await db.exec(migration);
  await db.exec("set role authenticated;");
  expect((await rpc("memory_state")).version).toBe(1);
});
