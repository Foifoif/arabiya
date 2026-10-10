import { describe, it, expect } from "vitest";
import { initialData } from "./model";
import { cloudData, type CloudHead } from "./cloud-model";
import { CLOUD_BASE, CLOUD_ENABLED, RECOVERY_KEY, CloudSync, CloudError } from "./cloud-sync";
function fixture() {
  const map = new Map<string,string>([[CLOUD_ENABLED,"yes"]]);
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key,value); } };
  let local = initialData();
  let head: CloudHead = { version: 0, data: null, mutationId: null, updatedAt: null };
  let failure: "none" | "before" | "after" = "none";
  const history = new Map<number, any>();
  const api = async (path: string, init?: RequestInit) => {
    if (path.startsWith("versions/")) return { data: structuredClone(history.get(Number(path.split("/")[1]))) };
    if (!init?.method) return { email: "owner@example.com", head: structuredClone(head) };
    const body = JSON.parse(init.body as string);
    if (failure === "before") throw new CloudError("Offline",0);
    if (body.expectedVersion !== head.version) throw new CloudError("Conflict",409);
    head = { version: head.version+1, data: cloudData(body.data), mutationId: body.mutationId, updatedAt: new Date().toISOString() };
    history.set(head.version, structuredClone(head.data));
    if (failure === "after") throw new CloudError("Lost response",0);
    return { head: structuredClone(head) };
  };
  const engine = new CloudSync(storage, () => local, data => { local = structuredClone(data); }, () => {}, api);
  return { storage, engine, get local() { return local; }, get head() { return head; }, setFailure(value: typeof failure) { failure = value; },
    remoteEdit() { head = { ...head, version: head.version+1, data: structuredClone(head.data!) }; head.data!.cards[0].back.headline = "remote edit"; } };
}
describe("durable cloud sync", () => {
  it("requires migration consent, preserves a recovery copy, and uploads edits automatically", async () => {
    const f = fixture(); await f.engine.sync();
    expect(f.engine.state.status).toBe("connect"); expect(f.head.data).toBeNull();
    await f.engine.resolve("local");
    expect(f.engine.state.status).toBe("saved"); expect(f.head.version).toBe(1);
    expect(JSON.parse(f.storage.getItem(RECOVERY_KEY)!)[0].data.cards).toHaveLength(5);
    f.local.cards[0].back.headline = "new local";
    await f.engine.sync(); expect(f.head.data!.cards[0].back.headline).toBe("new local");
  });
  it("retries a first upload that never reached the server instead of falsely reporting saved", async () => {
    const f = fixture(); await f.engine.sync(); f.setFailure("before"); await f.engine.resolve("local");
    expect(f.engine.state.status).toBe("offline"); expect(f.head.version).toBe(0);
    f.setFailure("none"); await f.engine.sync();
    expect(f.head.version).toBe(1); expect(f.engine.state.status).toBe("saved");
  });
  it("recovers a lost acknowledgement without duplicating the write", async () => {
    const f = fixture(); await f.engine.sync(); f.setFailure("after"); await f.engine.resolve("local");
    expect(f.head.version).toBe(1); expect(f.engine.state.status).toBe("offline");
    f.setFailure("none"); await f.engine.sync();
    expect(f.head.version).toBe(1); expect(f.engine.state.status).toBe("saved");
    expect(JSON.parse(f.storage.getItem(CLOUD_BASE)!).pending).toBeUndefined();
  });
  it("preserves both sides of a conflict until the user selects a collection", async () => {
    const f = fixture(); await f.engine.sync(); await f.engine.resolve("local");
    f.local.cards[0].back.headline = "local edit"; f.remoteEdit();
    await f.engine.sync(); expect(f.engine.state.status).toBe("conflict");
    expect(f.local.cards[0].back.headline).toBe("local edit"); expect(f.head.data!.cards[0].back.headline).toBe("remote edit");
    await f.engine.resolve("cloud"); expect(f.local.cards[0].back.headline).toBe("remote edit");
    expect(JSON.parse(f.storage.getItem(RECOVERY_KEY)!)[0].data.cards[0].back.headline).toBe("local edit");
  });
  it("pulls a changed cloud collection when the local collection is clean", async () => {
    const f = fixture(); await f.engine.sync(); await f.engine.resolve("local"); f.remoteEdit(); await f.engine.sync();
    expect(f.local.cards[0].back.headline).toBe("remote edit"); expect(f.engine.state.status).toBe("saved");
  });
  it("restores an earlier version as a new save", async () => {
    const f = fixture(); await f.engine.sync(); await f.engine.resolve("local");
    f.local.cards[0].back.headline = "new"; await f.engine.sync();
    await f.engine.restore(1);
    expect(f.head.version).toBe(3); expect(f.local.cards[0].back.headline).toBe("book");
  });
});
