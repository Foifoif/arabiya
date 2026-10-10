import { initialData, validateData, type Data } from "./model";
export const STORAGE_KEY = "memory-cards:v2";
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function loadData(storage: StoragePort): Data {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null) return validateData(JSON.parse(raw));
  const data = initialData();
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}
export function commitData(
  storage: StoragePort,
  current: Data,
  mutate: (draft: Data) => void,
): Data {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null && JSON.parse(raw).revision !== current.revision)
    throw new Error("Data changed in another tab. Reload before saving.");
  const next = structuredClone(current);
  mutate(next);
  next.revision++;
  const valid = validateData(next);
  storage.setItem(STORAGE_KEY, JSON.stringify(valid));
  return valid;
}
export const exportBackup = (data: Data) =>
  JSON.stringify({ format: "memory-cards", version: 2, data }, null, 2);
export function parseBackup(raw: string) {
  if (raw.length > 10000000) throw new Error("Backup must be under 10 MB.");
  const value = JSON.parse(raw);
  if (value.format !== "memory-cards" || value.version !== 2)
    throw new Error("Choose a Memory version 2 backup.");
  return validateData(value.data);
}
