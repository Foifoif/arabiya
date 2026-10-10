import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { initialData } from "../src/model";
import { cloudData } from "../src/cloud-model";
const nav = (page: Page, name: string) => page.getByRole("navigation").filter({ visible: true }).getByRole("button", { name, exact: true }).click();
const read = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("memory-cards:v2")!));
const owner = "11111111-1111-4111-8111-111111111111";
const email = "aliafsh.3@gmail.com";
const jwt = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", role: "authenticated", email })).toString("base64url")}.test`;
function server() {
  let head: any = { version: 0, data: null, updatedAt: null, mutationId: null };
  const history = new Map<number, any>();
  async function connect(context: BrowserContext) {
    const connection = { offline: false, rejectLogin: false };
    await context.route("**/cloud/config", route => route.fulfill({ json: { url: "https://test-project.supabase.co", publishableKey: "sb_publishable_test" } }));
    await context.route("https://test-project.supabase.co/auth/v1/**", async route => {
      if (connection.rejectLogin) return route.fulfill({ status: 400, json: { message: "Invalid login credentials", code: "invalid_credentials" } });
      if (route.request().url().includes("/logout")) return route.fulfill({ json: {} });
      return route.fulfill({ json: { access_token: jwt, refresh_token: "test-refresh-token", expires_in: 3600, token_type: "bearer", user: { id: owner, aud: "authenticated", email, email_confirmed_at: new Date().toISOString() } } });
    });
    await context.route("**/cloud/api/**", async route => {
      if (connection.offline) return route.abort("internetdisconnected");
      if (route.request().headers().authorization !== `Bearer ${jwt}`) return route.fulfill({ status: 401, json: { error: "Sign in" } });
      const path = new URL(route.request().url()).pathname.replace("/cloud/api/", "");
      if (path === "state" && route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        if (head.version !== body.expectedVersion) return route.fulfill({ status: 409, json: { error: "Another device saved first." } });
        head = { version: head.version + 1, data: body.data, mutationId: body.mutationId, updatedAt: new Date().toISOString() };
        history.set(head.version, structuredClone(head));
        return route.fulfill({ json: { head } });
      }
      if (path === "state") return route.fulfill({ json: { email, head } });
      if (path === "versions") return route.fulfill({ json: { versions: [...history.values()].reverse().map(item => ({ version: item.version, updatedAt: item.updatedAt, cards: item.data.cards.length, reviews: item.data.reviews.length })) } });
      if (path.startsWith("versions/")) return route.fulfill({ json: { data: history.get(Number(path.split("/")[1])).data } });
      return route.fulfill({ status: 404, json: {} });
    });
    return connection;
  }
  return { connect, head: () => head };
}
async function login(page: Page) {
  await nav(page, "More");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function add(page: Page, label: string) {
  await nav(page, "Cards");
  await page.getByRole("button", { name: "Add Card", exact: true }).click();
  await page.getByLabel("Front headline", { exact: true }).fill(label);
  await page.getByLabel("Back headline", { exact: true }).fill(label);
  await page.getByRole("button", { name: "Save card", exact: true }).click();
}
const saved = (page: Page) => expect(page.locator(".cloud-panel").getByRole("status")).toHaveText("Saved to cloud");

test("sign-in, explicit migration, two devices, offline conflict and version recovery", async ({ page, context, browser, baseURL }, info) => {
  const remote = server();
  const first = await remote.connect(context);
  await page.goto("/");
  const original = await read(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Connect your collection" })).toBeVisible();
  expect(remote.head().version).toBe(0);
  expect((await read(page)).cards).toEqual(original.cards);
  await page.getByRole("button", { name: "Use this device’s collection" }).click();
  await saved(page);
  await add(page, "First device card");
  await nav(page, "More");
  await saved(page);
  expect(remote.head().data.cards).toHaveLength(6);
  await page.reload();
  await nav(page, "More");
  await saved(page);

  const otherContext = await browser.newContext({ baseURL, viewport: page.viewportSize()! });
  try {
    await remote.connect(otherContext);
    const other = await otherContext.newPage();
    await other.goto("/");
    await login(other);
    await other.getByRole("button", { name: "Load cloud collection" }).click();
    await saved(other);
    expect((await read(other)).cards).toEqual(remote.head().data.cards);

    first.offline = true;
    await add(page, "Offline edit");
    await nav(page, "More");
    await expect(page.locator(".cloud-panel").getByRole("status")).toContainText("waiting to sync");
    expect((await read(page)).cards).toHaveLength(7);
    await add(other, "Other device edit");
    await nav(other, "More");
    await saved(other);
    first.offline = false;
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("heading", { name: "Both collections changed" })).toBeVisible();
    expect((await read(page)).cards.some((card: any) => card.front.headline === "Offline edit")).toBe(true);
    expect(remote.head().data.cards.some((card: any) => card.front.headline === "Other device edit")).toBe(true);
    await page.screenshot({ path: `test-results/cloud-conflict-${info.project.name}.png`, fullPage: true });
    await page.getByRole("button", { name: "Load cloud collection" }).click();
    await saved(page);
    const copies = await page.evaluate(() => JSON.parse(localStorage.getItem("memory:local-recovery")!));
    expect(copies.some((copy: any) => copy.data.cards.some((card: any) => card.front.headline === "Offline edit"))).toBe(true);

    await page.getByRole("button", { name: "Show saved versions" }).click();
    await page.getByRole("button", { name: "Restore version 2", exact: true }).click();
    await page.getByRole("button", { name: "Confirm restore" }).click();
    await saved(page);
    await expect.poll(() => remote.head().version).toBe(4);
    expect(remote.head().data.cards).toHaveLength(6);
    await other.getByRole("button", { name: "Sync now" }).click();
    await expect.poll(async () => (await read(other)).cards.length).toBe(6);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByText("Saved on this device", { exact: true }).first()).toBeVisible();
    await nav(page, "More");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect((await read(page)).cards).toHaveLength(6);
  } finally { await otherContext.close(); }
});

test("failed sign-in preserves cards and provides a retryable form", async ({ page, context }) => {
  const remote = server();
  const connection = await remote.connect(context);
  connection.rejectLogin = true;
  await context.addInitScript(data => localStorage.setItem("memory-cards:v2", JSON.stringify(data)), cloudData(initialData()));
  await page.goto("/");
  const original = await read(page);
  await login(page);
  await expect(page.getByRole("alert")).toContainText("Could not sign in");
  expect((await read(page)).cards).toEqual(original.cards);
  expect(remote.head().version).toBe(0);
});
