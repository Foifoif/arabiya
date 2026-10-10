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

Commit the source changes and regenerated `public/` together, review the branch preview, then merge to `main` to publish. Only `public/` is served as static content; source, repository files, and local database files are outside that directory.

## Data and rollback

Memory saves cards and progress in each browser under `memory-cards:v2`. It currently does not sync across devices. Use More → Export backup to move data. Data from localhost does not automatically transfer to the live domain.

The previous application remains in Git history at `0c36ad9a527908eed1f07950c4aeac447f16f6ba`, and its root `index.html` is retained outside the published directory. The previous production deployment is `b9113b42-aad6-42d9-a578-0d1cc7809461` (https://b9113b42.arabiya.pages.dev). Cloudflare's deployment rollback can restore it. Reverting the Memory deployment commit also restores the prior publishing directory.

The existing `functions/` endpoints and `arabiya-db` D1 database are unchanged. No database migrations or deletions are part of this frontend deployment. Memory does not call the legacy API or import its lesson data.

Translation uses MyMemory only on explicit Translate actions; returned text is editable and should be reviewed before saving.
