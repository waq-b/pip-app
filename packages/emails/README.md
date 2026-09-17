# @finance-app/emails

Pip's email templates, built from the Claude Design "Pip Emails" board. Rendering only: each
template is a pure function from a plain input to `{ subject, preheader, html, text }`. Nothing here
sends email — that's phase 6's `EmailSender` (Resend).

```ts
import { weekDigestEmail } from "@finance-app/emails";
const { subject, preheader, html, text } = weekDigestEmail(input);
```

| Template              | When                                        | Advice label |
| --------------------- | ------------------------------------------- | ------------ |
| `signInCodeEmail`     | Sign-in (Supabase sends it — see below)     | no           |
| `weekDigestEmail`     | Monday. Quiet, busy, missing pot, stale     | yes          |
| `alertEmail`          | Limit 80%, cap reached, urgent move, push   | money only   |
| `recommendationEmail` | A recommendation that can't wait for Monday | yes          |
| `waitlistEmail`       | Someone joins the waitlist                  | no           |
| `youreInEmail`        | Someone is let in                           | no           |

## Commands

```bash
pnpm --filter @finance-app/emails preview   # out/index.html + regenerates supabase/sign-in-code.html
pnpm --filter @finance-app/emails test
pnpm --filter @finance-app/emails mark      # regenerates apps/web/public/email/pip-mark-96.png
```

## Supabase sign-in template

`supabase/sign-in-code.html` is generated — don't edit it. To install it:

1. Supabase → Authentication → Emails → Templates → **Magic Link**: subject `Your Pip code: {{ .Token }}`, body = the file's contents.
2. Authentication → Providers → Email: **Email OTP Expiration = 600** (the email says 10 minutes), Email OTP Length = 8.
3. The mark image loads from `https://pip-old.example.net/email/pip-mark-96.png`, so it appears once this branch is deployed. Until then the text wordmark stands in.

See `docs/ARCHITECTURE.md` → Email templates for the rules the templates follow.
