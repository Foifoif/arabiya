# Email-only rollout — awaiting database setup

Owner explicitly requested access by email alone, accepting that others can view, edit and delete cards. No SMTP provider is needed. The email is a collection selector, not authentication.

App changes are prepared on `codex/passwordless-email` (PR 7). Existing account UUID, cards and history are preserved. Existing password sessions still work.

Before merging/deploying: in the existing Supabase project SQL Editor run `supabase/migrations/20261105_email_only.sql`. It grants anonymous callers access to the four collection RPCs and resolves the original owner only when the request supplies the approved email header. The private tables remain inaccessible directly. Knowing the email suffices to access this collection, including through the public Supabase API.

Then deploy and verify connecting by email, loading the current cloud collection, saving and syncing across devices. Never recreate the account or overwrite its collection with an empty device collection. The existing collection-choice and version-recovery controls remain in place.

No production database changes have been applied from this session. No provider costs are introduced.
