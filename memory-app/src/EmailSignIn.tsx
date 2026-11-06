import { useState } from "react";
import { getCloudClient } from "./cloud-auth";

export function EmailSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  async function send() {
    if (Date.now() < retryAt) {
      setError("Please wait a minute before requesting another code."); return;
    }
    setBusy(true); setError("");
    try {
      const client = await getCloudClient();
      const result = await client.auth.signInWithOtp({
        email: email.trim(), options: { shouldCreateUser: false },
      });
      if (result.error) throw new Error("Could not send a code. Check your email address and try again shortly.");
      setSentTo(email.trim()); setCode(""); setRetryAt(Date.now() + 60000);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError("");
    try {
      const client = await getCloudClient();
      const result = await client.auth.verifyOtp({ email: sentTo, token: code.trim(), type: "email" });
      if (result.error || !result.data.session) throw new Error("That code is invalid or expired. Try again or request a new code.");
      setCode(""); onSignedIn();
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="cloud-login">
    <form onSubmit={event => { event.preventDefault(); void (sentTo ? verify() : send()); }}>
      {!sentTo ? <>
        <label>Email<input type="email" autoComplete="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <button className="button primary" disabled={busy}>{busy ? "Sending…" : "Send sign-in code"}</button>
      </> : <>
        <p role="status">If this address has access, a sign-in code has been sent to {sentTo}. Check your inbox and spam folder.</p>
        <label>Sign-in code<input autoComplete="one-time-code" inputMode="numeric" required pattern="[0-9]{6,10}" maxLength={10} disabled={busy} value={code} onChange={e => setCode(e.target.value)} /></label>
        <button className="button primary" disabled={busy}>{busy ? "Signing in…" : "Verify and sign in"}</button>
        <div className="button-row">
          <button type="button" className="button secondary" disabled={busy} onClick={() => void send()}>Send another code</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => { setSentTo(""); setCode(""); setError(""); }}>Use another email</button>
        </div>
      </>}
    </form>
    <p className="helper">No password needed. Use your existing account email. Your cards stay attached to the same account, and this device stays signed in.</p>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
