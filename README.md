# Ali's Arabic — Memory

Live domain: https://alisarabic.com

The Memory frontend lives in `memory-app/`. Cloudflare Pages project `arabiya` serves the checked-in production bundle from `public/`. The existing GitHub connection deploys `main` automatically. The build command stays empty: build locally before committing the bundle.

## Develop and publish

```sh
cd memory-app
npm ci
npm run dev
# Before publishing:
npm test
npm run build
```

Commit source changes, regenerated `public/`, and `functions/cloud/[[path]].js` together, review the branch preview, then merge to `main` to publish. The build command bundles the cloud API as well as the frontend. Only `public/` is served as static content; source, repository files, and local database files are outside that directory.

## Data and rollback

Memory saves cards and progress in each browser under `memory-cards:v2`. The cloud-saving feature in this branch adds opt-in Supabase synchronization through More → Cloud saving. On first sign-in, explicitly choose whether to upload this device's collection or load the cloud collection. No automatic first-time replacement occurs. Data from localhost does not automatically transfer to the live domain.

Cloud saving includes saved cards, completed reviews, preferences, and reference links. Draft inputs and in-progress review rounds stay device-local. Concurrent edits stop at a conflict prompt instead of silently overwriting either collection. Offline edits stay local and retry when connected. "Saved to cloud" means the server acknowledged the collection. Signing out retains local cards and stops synchronization on that browser.

The latest 50 cloud saves are retained in Supabase. Restoring one creates a new version. The latest five local recovery snapshots are retained before replacing local content; download them under More → Device recovery copies. More → Export cards & progress remains available for a portable backup independent of cloud saving. These snapshots do not protect against loss of the entire Supabase project; retain occasional exported backups for that case.

## Cloud setup

- Apply `supabase/migrations/202610100001_cloud_save.sql` to the dedicated Supabase project. It creates private tables and four authenticated RPCs. Every RPC independently checks the confirmed owner email. Anonymous callers and other accounts have no access.
- Create the single app user through Supabase Authentication → Users, with the owner entering their own password. Disable public sign-ups in Authentication → Sign In / Providers. Email/password login does not depend on an email-delivery provider. Password recovery currently requires the project owner to manage the account in Supabase; self-service recovery emails are not configured.
- The Pages variables in `wrangler.toml` contain the Supabase URL, **publishable** key, and allowed email. Never substitute a secret or service-role key. No privileged database key is used by the app. The server validates each session with Supabase Auth and sends the user's token to the database.
- Run `npm test` (including PostgreSQL schema/permission tests), `npm run build`, and the Playwright suite against a stable build preview. Browser cloud tests mock the network; separately verify real sign-in, ownership denial, migration, and a second browser before considering setup complete.

Deployment and real-account verification are still pending. See `docs/cloud-save-plan.md` for the current completion gates.

The previous application remains in Git history at `0c36ad9a527908eed1f07950c4aeac447f16f6ba`, and its root `index.html` is retained outside the published directory. The previous production deployment is `b9113b42-aad6-42d9-a578-0d1cc7809461` (https://b9113b42.arabiya.pages.dev). Cloudflare's deployment rollback can restore it. Reverting the Memory deployment commit also restores the prior publishing directory.

The existing `functions/api/` endpoints and `arabiya-db` D1 database are unchanged. The new `/cloud/` API uses the separate Supabase project. Memory does not call the legacy API or import its lesson data.

Translation uses MyMemory only on explicit Translate actions; returned text is editable and should be reviewed before saving.
