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

Completion evidence still required: auth configuration, user sign-in, actual data migration from the user's browser, rejected unauthorized requests, cloud save/reload, isolated second-browser retrieval, lost-connection recovery, conflict test, version restore, live frontend rendering.
