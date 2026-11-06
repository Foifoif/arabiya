# Passwordless email rollout (prepared; not enabled in production)

The app requests an email OTP with `shouldCreateUser: false`, verifies it with Supabase, then follows the existing explicit collection connection flow. Existing account UUID, cards, row security, and sessions stay intact. Password login remains available during rollout.

Required operator setup:

1. Connect a transactional email provider to the existing Supabase project `bdcpqmlibrsrfnjzbugq` under Authentication → Email / SMTP settings. Verify a sender domain through its DNS provider. Enter the SMTP credential directly in Supabase; never commit or paste it into chat.
2. In Authentication → Email Templates → Magic Link, use a code template containing `{{ .Token }}`. Example subject: `Your Arabic practice sign-in code`; body: `<h2>Sign in to Arabic practice</h2><p>Your sign-in code is: <strong>{{ .Token }}</strong></p><p>If you did not request this code, ignore this email.</p>`. This code flow needs no redirect callback.
3. Keep public signup disabled and retain existing account and private database policies. Configure an appropriate OTP expiry (e.g. 10 minutes) and resend limits in Supabase; the UI also avoids immediate repeated requests.
4. Deploy this branch after delivery configuration, request a code for the existing account, and have the user enter it. Verify the existing cloud cards load and changes sync across two devices. Check expired/used codes and delivery failure. Do not delete/recreate the account.

No SMTP changes or production email delivery have been verified yet. No production deployment should be described as complete until the real inbox sign-in is tested.

References: https://supabase.com/docs/guides/auth/auth-email-passwordless and https://supabase.com/docs/guides/auth/auth-smtp
