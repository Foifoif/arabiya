import { useState } from "react";
export function EmailSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="cloud-login" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError("");
    void (async () => {
      try {
        const normalized = email.trim().toLowerCase();
        const response = await fetch("/cloud/api/state", {headers:{"X-Memory-Email": normalized}, cache:"no-store", signal:AbortSignal.timeout(20000)});
        if (!response.ok) throw new Error("Could not connect to this email’s collection. Check the address and try again.");
        localStorage.setItem("memory:collection-email", normalized);
        onSignedIn();
      } catch(e) {setError(e instanceof Error ? e.message : "Please try again.");}
      finally {setBusy(false);}
    })();
  }}>
    <label>Email<input type="email" autoComplete="email" required disabled={busy} value={email} onChange={e=>setEmail(e.target.value)} /></label>
    <button className="button primary" disabled={busy}>{busy ? "Connecting…" : "Connect collection"}</button>
    <p className="helper">Anyone who enters this email can view and change its cards. No password or email verification is required.</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </form>;
}
