# Private cloud saving

Authorized scope: private email sign-in, automatic saving, safe first migration, cross-device access, offline queued changes, conflict protection, recoverable versions, existing backup import/export, live deployment and verification.

Allowed identity supplied by the user: aliafsh.3@gmail.com. No public registration. No paid services without approval.

Provider: Supabase project `bdcpqmlibrsrfnjzbugq` (arabiya), created by the user in their other account. The user selected email + password login. The new database password was handled by the user and was not collected. Cloudflare Access activation is abandoned. Supabase Auth and Postgres now replace the provisional Access/D1 implementation; the existing legacy D1 API remains untouched. Only the publishable key is configured. No service-role or secret API key is required by the app.

Database migration: `supabase/migrations/202610100001_cloud_save.sql`. Private tables, restricted authenticated RPCs, verified owner email, atomic version checks, idempotent retries and the latest 50 snapshots. The app server verifies sessions with Supabase Auth and validates card data before forwarding the user's token to the RPC. SQL independently checks the confirmed owner's identity.

Verified setup (2026-10-10): User approved applying the migration; Supabase SQL editor returned success. User created their app password/account through the dashboard. Public sign-ups were disabled; anonymous sign-ins remain disabled. An actual anonymous call to `memory_state` returned HTTP 401, PostgreSQL `42501 permission denied`. Local verification: 38 unit/database/API tests pass, all 16 desktop/phone browser tests pass, and the final six affected browser tests pass after the UI layout refinement. Browser tests simulate cloud responses; real authenticated migration and sync still require verification after deployment.

Synchronization contract:
- Save locally before reporting success. Cloud status never says saved until the server acknowledges a write.
- First connection explicitly chooses upload of existing local collection or loading the cloud collection. Preserve a local recovery snapshot before replacement.
- Each cloud write uses an expected server version and unique mutation ID. Conflicting writes return conflict without replacement. Lost responses are reconciled by mutation ID.
- Sync saved cards, completed review records, settings and reference links. In-progress practice rounds and unsaved card editor drafts remain device-local.
- Pull automatically only when local data is unchanged since the last acknowledged cloud version. Otherwise show explicit conflict choices and preserve both snapshots.
- Keep earlier cloud versions. Restoration creates a new version and preserves the current version.
- Retry after reconnect, focus and a periodic check; coordinate tabs to avoid concurrent sync in one browser.

Production deployment verified: PR #3 merged as `5f7b0abd1628f7ed22e152f0e654e1b6a9070995`; Cloudflare deployment `5f3b0e3b-98f7-42a6-a964-fe014839bbc8` succeeded. The live `/cloud/config` returns the intended project's public configuration (HTTP 200); `/cloud/api/state` rejects anonymous callers (HTTP 401). The rendered live More screen contains the email/password form, and the existing browser still shows five saved cards after reload.

Authenticated live verification: the user signed in as the allowed Gmail account. The first connection showed five device cards, zero reviews, and an empty cloud collection. Uploaded this device's collection; the app reported Saved to cloud. After reload the same status returned. Version 1 contained five cards and zero reviews. A reversible light-theme change autosaved as version 2. Restoring version 1 returned the dark theme and created version 3, with versions 1 and 2 still available. No card content or review results were changed for this check.

Cross-session live verification (2026-10-11): the user signed in to the identical deployed app at `https://5a0da605.arabiya.pages.dev`, which has an isolated browser store. Loaded the five-card cloud collection and confirmed Saved to cloud. Simultaneous light-theme and card-motion edits on the two origins produced a successful save in the main session and a Both collections changed conflict in the second session. The second session retained its motion-off edit until explicitly loading the cloud copy. Restored the original version 3 from the main site; the second session received the restored dark theme and motion-on preference. Both card lists visibly matched the original five Arabic/English pairs and both reported Saved to cloud. No study results or card content were changed for this test.

Verification limitation: offline recovery was tested by simulated HTTP failures in browser tests, not by disconnecting the user's physical device. The live two-session check used separate origins in the same browser rather than a second physical device. Unit tests also cover server-save/response-loss recovery, and PostgreSQL tests cover atomic version checks, ownership, idempotency and retention. All implemented acceptance requirements are covered by these tests plus the live checks above.
