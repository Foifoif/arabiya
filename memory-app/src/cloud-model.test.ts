import { describe, it, expect } from "vitest";
import { initialData, nextRound } from "./model";
import { cloudData, fingerprint, decideSync, acknowledgePending } from "./cloud-model";

describe("cloud synchronization decisions", () => {
  const original = initialData();
  const base = { owner: "owner@example.com", version: 1, data: cloudData(original) };
  const remote = { version: 1, data: cloudData(original), mutationId: "first", updatedAt: null };
  it("does not upload card flips or round changes", () => {
    const local = structuredClone(original);
    nextRound(local);
    local.round!.revealed = true;
    local.revision++;
    expect(fingerprint(local)).toBe(fingerprint(original));
    expect(decideSync(local, base, remote)).toBe("same");
  });
  it("requires explicit first connection instead of replacing an existing collection", () => {
    expect(decideSync(initialData(), null, remote)).toBe("connect");
    expect(decideSync(original, null, { ...remote, version: 0, data: null })).toBe("connect");
  });
  it("uploads local changes and downloads remote changes only when the other side is clean", () => {
    const changed = structuredClone(original);
    changed.cards[0].back.headline = "edited";
    expect(decideSync(changed, base, remote)).toBe("upload");
    expect(decideSync(original, base, { ...remote, version: 2, data: changed })).toBe("download");
  });
  it("blocks concurrent edits instead of silently choosing a device", () => {
    const a = structuredClone(original), b = structuredClone(original);
    a.cards[0].back.headline = "edit A";
    b.cards[0].back.headline = "edit B";
    expect(decideSync(a, base, { ...remote, version: 2, data: b })).toBe("conflict");
  });
  it("acknowledges an upload after a lost response without losing newer local edits", () => {
    const sent = structuredClone(original), newer = structuredClone(original);
    sent.cards[0].back.headline = "sent";
    newer.cards[0].back.headline = "newer";
    const pending = { ...base, pending: { id: "write-id", expectedVersion: 1, data: sent } };
    const received = { ...remote, version: 2, mutationId: "write-id", data: sent };
    const recovered = acknowledgePending(pending, received);
    expect(recovered.pending).toBeUndefined();
    expect(decideSync(newer, recovered, received)).toBe("upload");
  });
  it("recognizes identical content even if metadata was not persisted", () => {
    expect(decideSync(original, null, { ...remote, version: 9 })).toBe("same");
  });
});
