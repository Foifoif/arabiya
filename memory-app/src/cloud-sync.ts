import { validateData, type Data } from "./model";
import { cloudData, fingerprint, decideSync, acknowledgePending, type CloudHead, type SyncBase } from "./cloud-model";
import type { StoragePort } from "./storage";
import { accessToken } from "./cloud-auth";

export const CLOUD_ENABLED = "memory:cloud-enabled";
export const CLOUD_BASE = "memory:cloud-base";
export const RECOVERY_KEY = "memory:local-recovery";
export type CloudStatus = "local" | "checking" | "signed-out" | "connect" | "saved" | "syncing" | "offline" | "conflict" | "error";
export type CloudState = { status: CloudStatus; email: string; head: CloudHead | null; error: string };
export type Version = { version: number; updatedAt: string; cards: number; reviews: number };
export class CloudError extends Error {
  constructor(message: string, public code: number) { super(message); }
}
export async function cloudRequest(path: string, init?: RequestInit) {
  let response: Response;
  try {
    const token = await accessToken();
    if (!token) throw new CloudError("Sign in to cloud saving.", 401);
    response = await fetch(`/cloud/api/${path}`, { ...init, credentials: "same-origin", redirect: "error",
      headers: { "Content-Type": "application/json", ...init?.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  } catch (error) {
    if (error instanceof CloudError) throw error;
    throw new CloudError(navigator.onLine ? "Cloud could not be reached. Sign in again if your session expired." : "Offline. Your changes are saved on this device.", 0);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) throw new CloudError("Sign in to cloud saving.", 401);
  const json = await response.json();
  if (!response.ok) throw new CloudError(json.error || "Cloud save failed. Your local data is safe.", response.status);
  return json;
}
export function parseHead(value: any): CloudHead {
  if (!Number.isSafeInteger(value.version) || value.version < 0) throw new Error("Invalid cloud version.");
  return { version: value.version, data: value.data ? validateData(value.data) : null,
    updatedAt: value.updatedAt || null, mutationId: value.mutationId || null };
}
export function saveRecovery(storage: StoragePort, data: Data, label: string) {
  const previous = JSON.parse(storage.getItem(RECOVERY_KEY) || "[]");
  storage.setItem(RECOVERY_KEY, JSON.stringify([{ at: new Date().toISOString(), label, data: cloudData(data) }, ...previous].slice(0, 5)));
}
export class CloudSync {
  state: CloudState = { status: "local", email: "", head: null, error: "" };
  busy = false;
  stopped = false;
  constructor(private storage: StoragePort, private getLocal: () => Data,
    private applyLocal: (data: Data) => void, private changed: (state: CloudState) => void,
    private api: typeof cloudRequest = cloudRequest) {}
  private emit(status: CloudStatus, error = "") {
    this.state = { ...this.state, status, error };
    if (!this.stopped) this.changed(this.state);
  }
  private base(): SyncBase | null {
    const raw = this.storage.getItem(CLOUD_BASE);
    if (!raw) return null;
    const base = JSON.parse(raw) as SyncBase;
    if (base.owner !== this.state.email) return null;
    validateData(base.data);
    if (base.pending) validateData(base.pending.data);
    if (!Number.isSafeInteger(base.version) || base.version < 0) throw new Error("Invalid sync metadata. Export your data before reconnecting.");
    return base;
  }
  private setBase(base: SyncBase) { this.storage.setItem(CLOUD_BASE, JSON.stringify(base)); }
  private accept(head: CloudHead) {
    if (!head.data) throw new Error("The cloud collection is empty.");
    this.setBase({ owner: this.state.email, version: head.version, data: cloudData(head.data) });
  }
  private failure(error: unknown) {
    const message = error instanceof Error ? error.message : "Cloud save failed.";
    if (error instanceof CloudError && (error.code === 401 || error.code === 403)) this.state = { ...this.state, email: "" };
    this.emit(error instanceof CloudError && error.code === 409 ? "conflict" :
      error instanceof CloudError && (error.code === 401 || error.code === 403) ? "signed-out" :
      error instanceof CloudError && error.code === 0 ? "offline" : "error", message);
  }
  async sync() {
    if (this.busy || this.stopped) return;
    if (this.storage.getItem(CLOUD_ENABLED) !== "yes") {
      this.state = { ...this.state, email: "", head: null };
      this.emit("local");
      return;
    }
    this.busy = true;
    try {
      if (!this.state.email) this.emit("checking");
      const response = await this.api("state");
      if (this.stopped) return;
      this.state = { ...this.state, email: response.email, head: parseHead(response.head) };
      const head = this.state.head!;
      let base = this.base();
      if (base) {
        const recovered = acknowledgePending(base, head);
        if (recovered !== base) { base = recovered; this.setBase(base); }
      }
      const local = this.getLocal();
      const decision = base?.pending && head.version === base.pending.expectedVersion
        ? "upload" : decideSync(local, base, head);
      if (decision === "connect" || decision === "conflict") { this.emit(decision); return; }
      if (decision === "download") {
        if (!head.data) { this.emit("conflict", "Cloud collection changed unexpectedly."); return; }
        saveRecovery(this.storage, local, "Before receiving cloud changes");
        this.applyLocal(head.data);
        this.accept(head);
        this.emit("saved");
      } else if (decision === "upload") {
        await this.upload(base!.version);
      } else {
        if (head.data) this.accept(head);
        this.emit("saved");
      }
    } catch (error) { if (!this.stopped) this.failure(error); }
    finally { this.busy = false; }
  }
  private async upload(expectedVersion: number) {
    const snapshot = cloudData(this.getLocal());
    const id = crypto.randomUUID();
    const oldBase = this.base();
    // Persist the operation before sending it so a lost response can be recovered.
    this.setBase({ owner: this.state.email, version: expectedVersion,
      data: oldBase?.data || snapshot, pending: { id, data: snapshot, expectedVersion } });
    this.emit("syncing");
    const response = await this.api("state", { method: "PUT", body: JSON.stringify({ expectedVersion, mutationId: id, data: snapshot }) });
    if (this.stopped) return;
    const head = parseHead(response.head);
    this.state = { ...this.state, head };
    this.accept(head);
    this.emit(fingerprint(this.getLocal()) === fingerprint(snapshot) ? "saved" : "syncing");
  }
  async resolve(choice: "local" | "cloud") {
    if (this.busy || !this.state.head) return;
    this.busy = true;
    try {
      const shownVersion = this.state.head.version;
      const response = await this.api("state");
      if (this.stopped) return;
      const head = parseHead(response.head);
      this.state = { ...this.state, email: response.email, head };
      if (head.version !== shownVersion) { this.emit("conflict", "The cloud changed again. Review the updated counts before choosing."); return; }
      saveRecovery(this.storage, this.getLocal(), "Before connecting or resolving a conflict");
      if (choice === "cloud") {
        if (!head.data) throw new Error("There is no cloud collection to load.");
        this.applyLocal(head.data);
        this.accept(head);
        this.emit("saved");
      } else {
        // Remote data remains in the server's version history when replaced.
        if (head.data) this.accept(head);
        await this.upload(head.version);
      }
    } catch (error) { if (!this.stopped) this.failure(error); }
    finally { this.busy = false; }
  }
  async restore(version: number) {
    if (this.busy || this.state.status !== "saved" || !this.state.head) throw new Error("Finish syncing before restoring a version.");
    this.busy = true;
    try {
      const current = await this.api("state");
      const head = parseHead(current.head);
      if (head.version !== this.state.head.version || fingerprint(this.getLocal()) !== fingerprint(this.base()!.data))
        throw new Error("Your collection changed. Sync and review the version again.");
      const beforeFetch = fingerprint(this.getLocal());
      const response = await this.api(`versions/${version}`);
      if (fingerprint(this.getLocal()) !== beforeFetch) throw new Error("Your collection changed while loading the version. Review it again.");
      const restored = validateData(response.data);
      saveRecovery(this.storage, this.getLocal(), "Before restoring an earlier version");
      this.applyLocal(restored);
      await this.upload(head.version);
    } catch (error) { this.failure(error); throw error; }
    finally { this.busy = false; }
  }
}
