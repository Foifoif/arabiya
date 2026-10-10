import { validateData, type Data } from "./model";

// Practice rounds are device-local. Only saved cards, completed reviews,
// preferences and reference links participate in cloud synchronization.
export function cloudData(data: Data): Data {
  return validateData({ ...structuredClone(data), revision: 0, round: null,
    formatBag: [], recentFormats: [], recentCardIds: [] });
}
export const fingerprint = (data: Data) => JSON.stringify(cloudData(data));
export type CloudHead = {
  version: number;
  data: Data | null;
  updatedAt: string | null;
  mutationId: string | null;
};
export type SyncBase = {
  owner: string;
  version: number;
  data: Data;
  pending?: { id: string; data: Data; expectedVersion: number };
};
export type SyncDecision = "same" | "upload" | "download" | "conflict" | "connect";
export function decideSync(local: Data, base: SyncBase | null, remote: CloudHead): SyncDecision {
  if (remote.data && fingerprint(local) === fingerprint(remote.data)) return "same";
  if (!base) return "connect";
  const localChanged = fingerprint(local) !== fingerprint(base.data);
  const remoteChanged = remote.version !== base.version;
  if (remoteChanged && localChanged) return "conflict";
  if (remoteChanged) return "download";
  return localChanged ? "upload" : "same";
}
export function acknowledgePending(base: SyncBase, remote: CloudHead): SyncBase {
  if (base.pending && remote.mutationId === base.pending.id && remote.data &&
      fingerprint(remote.data) === fingerprint(base.pending.data)) {
    return { owner: base.owner, version: remote.version, data: cloudData(remote.data) };
  }
  return base;
}
