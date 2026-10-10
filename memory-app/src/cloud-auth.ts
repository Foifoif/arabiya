import type { SupabaseClient } from "@supabase/supabase-js";

let clientPromise: Promise<SupabaseClient> | undefined;
export function getCloudClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch("/cloud/config", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
        throw new Error("Cloud sign-in is not available yet. Your cards remain saved on this device.");
      const config = await response.json();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url) ||
          !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(config.publishableKey)) throw new Error("Invalid cloud configuration.");
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "memory:auth" },
      });
    })().catch(error => { clientPromise = undefined; throw error; });
  }
  return clientPromise;
}
export async function accessToken() {
  const client = await getCloudClient();
  // The SDK refreshes expiring sessions. The server still verifies every token.
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session?.access_token || null;
}
