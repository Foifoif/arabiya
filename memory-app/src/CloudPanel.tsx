import { useEffect, useRef, useState } from "react";
import type { Data } from "./model";
import { CLOUD_ENABLED, RECOVERY_KEY, CloudSync, cloudRequest, type CloudState, type Version } from "./cloud-sync";
import { fingerprint } from "./cloud-model";
import { exportBackup } from "./storage";
import { getCloudClient } from "./cloud-auth";

export const statusLabel: Record<CloudState["status"], string> = {
  local: "Saved on this device", checking: "Checking cloud", "signed-out": "Sign in to sync",
  connect: "Choose cloud collection", saved: "Saved to cloud", syncing: "Syncing",
  offline: "Saved on device · waiting to sync", conflict: "Sync conflict · changes kept", error: "Cloud save needs attention",
};
export function useCloudSync(data: Data | null, getLocal: () => Data, applyLocal: (data: Data) => void) {
  const [state, setState] = useState<CloudState>({ status: "local", email: "", head: null, error: "" });
  const engine = useRef<CloudSync | null>(null);
  const callbacks = useRef({ getLocal, applyLocal });
  callbacks.current = { getLocal, applyLocal };
  const runner = useRef<() => void>(() => {});
  useEffect(() => {
    if (!data) return;
    const sync = new CloudSync(localStorage, () => callbacks.current.getLocal(), d => callbacks.current.applyLocal(d), setState);
    engine.current = sync;
    const run = () => {
      if (navigator.locks) {
        void navigator.locks.request("memory-cloud-sync", { ifAvailable: true }, async lock => { if (lock) await sync.sync(); });
      } else void sync.sync();
    };
    runner.current = run;
    run();
    const interval = setInterval(run, 15000);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    const changedElsewhere = (event: StorageEvent) => { if (event.key === CLOUD_ENABLED) run(); };
    window.addEventListener("storage", changedElsewhere);
    return () => { sync.stopped = true; clearInterval(interval); window.removeEventListener("online", run); window.removeEventListener("focus", run); window.removeEventListener("storage", changedElsewhere); };
  }, [!!data]);
  const content = data ? fingerprint(data) : "";
  useEffect(() => {
    if (localStorage.getItem(CLOUD_ENABLED) !== "yes") return;
    setState(previous => previous.status === "saved" ? { ...previous, status: "syncing" } : previous);
    const timer = setTimeout(() => runner.current(), 800);
    return () => clearTimeout(timer);
  }, [content]);
  return { state, engine, retry: () => runner.current() };
}
export function CloudPanel({ cloud, data }: { cloud: ReturnType<typeof useCloudSync>; data: Data }) {
  const { state, engine, retry } = cloud;
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<Version | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const localRecoveries = (() => { try { return JSON.parse(localStorage.getItem(RECOVERY_KEY) || "[]") as { at: string; label: string; data: Data }[]; } catch { return []; } })();
  async function action(run: () => Promise<void>) {
    setWorking(true); setError("");
    try { await run(); } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setWorking(false); }
  }
  function downloadRecovery(index: number) {
    const url = URL.createObjectURL(new Blob([exportBackup(localRecoveries[index].data)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "memory-recovery.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel cloud-panel">
    <h2>Cloud saving</h2>
    <p role="status">{statusLabel[state.status]}</p>
    {state.email && <p className="muted">{state.email}</p>}
    <p className="helper">Saved cards, review history, preferences and links sync between signed-in devices. Unfinished card drafts stay on this device.</p>
    {!state.email && <form className="cloud-login" onSubmit={event => {
      event.preventDefault();
      void action(async () => {
        const client = await getCloudClient();
        const result = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw new Error("Could not sign in. Check your email and password, then try again.");
        setPassword("");
        localStorage.setItem(CLOUD_ENABLED, "yes");
        retry();
      });
    }}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="button primary" disabled={working}>Sign in</button>
      <p className="helper">Private access for your existing account. Signing in does not replace your cards; you’ll choose which collection to use first.</p>
    </form>}
    <div className="button-row">
      {state.status !== "local" && <button className="button secondary" onClick={retry} disabled={working}>Sync now</button>}
      {state.email && <button className="button secondary" disabled={working || state.status === "syncing" || state.status === "checking"} onClick={() => action(async () => {
        const client = await getCloudClient();
        const result = await client.auth.signOut({ scope: "local" });
        if (result.error) throw result.error;
        localStorage.removeItem(CLOUD_ENABLED);
        if (engine.current) engine.current.stopped = true;
        window.location.reload();
      })}>Sign out</button>}
    </div>
    {state.email && <p className="helper">Signing out stops syncing on this device. Its saved cards and recovery copies remain available here.</p>}
    {(state.status === "connect" || state.status === "conflict") && <div className="cloud-choice">
      <h3>{state.status === "connect" ? "Connect your collection" : "Both collections changed"}</h3>
      <p>This device: {data.cards.length} cards · {data.reviews.length} reviews</p>
      <p>Cloud: {state.head?.data?.cards.length || 0} cards · {state.head?.data?.reviews.length || 0} reviews</p>
      <p className="helper">Choose the collection to continue with. Replaced local data is kept in device recovery below; replaced cloud data remains in earlier versions. These choices replace the collection rather than merge it.</p>
      <div className="button-row">
        <button className="button primary" disabled={working} onClick={() => action(() => engine.current!.resolve("local"))}>Use this device’s collection</button>
        {state.head?.data && <button className="button secondary" disabled={working} onClick={() => action(() => engine.current!.resolve("cloud"))}>Load cloud collection</button>}
      </div>
    </div>}
    {(state.error || error) && <p role="alert" className="inline-error">{error || state.error}</p>}
    {state.email && <div className="cloud-history">
      <h3>Earlier versions</h3>
      <p className="helper">The latest 50 cloud saves are retained. Restoring creates a new save and keeps the current version in history.</p>
      <button className="button secondary" disabled={working || state.status !== "saved"} onClick={() => action(async () => {
        const response = await cloudRequest("versions"); setVersions(response.versions); setSelected(null);
      })}>Show saved versions</button>
      {versions.map(version => <div className="cloud-version" key={version.version}>
        <span>{new Date(version.updatedAt).toLocaleString()} · {version.cards} cards · {version.reviews} reviews</span>
        <button className="text-button" disabled={working || state.status !== "saved"} onClick={() => setSelected(version)}>Restore version {version.version}</button>
      </div>)}
      {selected && <div className="cloud-choice">
        <p>Replace your collection with version {selected.version} ({selected.cards} cards, {selected.reviews} reviews)? Your current collection will remain recoverable.</p>
        <div className="button-row">
          <button className="button primary" disabled={working || state.status !== "saved"} onClick={() => action(async () => { await engine.current!.restore(selected.version); setSelected(null); setVersions([]); })}>Confirm restore</button>
          <button className="button secondary" disabled={working} onClick={() => setSelected(null)}>Cancel restore</button>
        </div>
      </div>}
    </div>}
    {localRecoveries.length > 0 && <details><summary>Device recovery copies</summary>
      <p className="helper">Download a copy, then use Restore backup below if you need to recover it. The latest five copies are retained on this device.</p>
      {localRecoveries.map((copy, index) => <div className="cloud-version" key={`${copy.at}-${index}`}>
        <span>{new Date(copy.at).toLocaleString()} · {copy.label}</span>
        <button className="text-button" onClick={() => downloadRecovery(index)}>Download recovery {index + 1}</button>
      </div>)}
    </details>}
  </section>;
}
