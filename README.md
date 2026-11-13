# ScAry Net

This package preserves the exact approved original two-column ScAry Net login design (logo, left hero, message bubbles, colors) and chat screens. Only these account features were added: signup Email, email verification, username/password recovery, and settings for username, password, and email. In the wordmark, only the capital **A** is icy blue. The chat interface and original CSS are otherwise unchanged. The left hero stays visible on desktop; no centered-login override is used.


ScAry Net is a text-only messaging website built on **Cloudflare Pages Functions + D1**. This version adds email verification, username/password recovery, and account settings, while preserving the approved navy-and-white logo and chat interface.

## New account features

- Sign up using a unique lowercase username (3–20 characters), **email address**, and password (8–25 characters).
- Email an **8-digit verification code** to confirm ownership of the email address. The code expires after 15 minutes.
- **Forgot username?** Enter your verified email: the recovery message includes your username.
- **Forgot password?** Request a code, verify it, and choose a new password. Changing passwords via recovery signs out all current sessions.
- In **Account settings** (gear icon), change the username, change the password, add or change the email address, and verify it.
- Changing username requires the current password because passwords are derived using the username. The code correctly re-derives the proof for the new username. Your old conversations remain linked to your account ID.
- Username and password changes send a security notification to the verified email. Changing the verified email also notifies the old address.
- Email is **not shown to other users**.

**Important:** Only **verified** email addresses can recover accounts. Previous users who signed up without email must sign in and add/verify an address in Settings. If they are already locked out, self-service recovery cannot work until an administrator provides a manual account recovery process.

## Before publishing: required email setup

This feature **needs a sending service**. This project uses **Resend**, which has a free tier (currently 3,000 emails per month, with a 100-email-per-day limit). Sending email to arbitrary users requires a domain you own and verify with Resend; a `pages.dev` address alone does not verify a sending domain. A domain registration may cost money. You do **not** need to put any secret or key in JavaScript or GitHub.

1. Create a Resend account: https://resend.com/ . Open **Domains** and add a domain you control; complete the DNS records and verification.
2. In Resend, create an API key with **send-email permission**.
3. In Cloudflare Dashboard, open your Pages project → **Settings → Variables and Secrets** (exact menu names may vary). Add **encrypted secrets**, available to the Pages Functions:
   - `RESEND_API_KEY`: the API key, e.g. `re_...` (SECRET)
   - `SCARY_FROM_EMAIL`: a sender on your verified domain, e.g. `ScAry Net <account@yourdomain.example>` (variable or secret)
   - `RECOVERY_SECRET`: a unique cryptographically random secret of at least 24 characters (SECRET); example generation in Terminal: `openssl rand -hex 32`
4. **Redeploy** the Pages project after adding secrets. Add equivalent values to any Preview deployment environment you want to test. Never publish these in GitHub or share them in chat.
5. Test signup with an email you own; enter the code under Account settings. Then test username recovery and password reset in a private browser window.

**Without these variables, signup and recovery explicitly report that email sending is not configured.** Existing user logins and chats continue working after the D1 migration.

### Keep your current D1 data! Important database step

The existing database holds accounts and messages. **Back it up first.** Do not delete, recreate, or reset it.

**If you already deployed ScAry Net and ran `schema.sql` with the old version:** Open the Cloudflare D1 database `scary-net-db` → **Console**, paste the complete included **`migration_email.sql`** and execute it **once**. It adds two nullable user fields and the email challenge/ticket tables without deleting prior chats.

Terminal alternative after logging into Cloudflare with Wrangler:

```bash
# Backup before changing schema (run from any writable directory)
npx wrangler d1 export scary-net-db --remote --output=./ScAry-Net-Backup.sql

# Run this ONCE from inside the ScAry Net project folder
npx wrangler d1 execute scary-net-db --remote --file=./migration_email.sql
```

**If you have NOT yet created the D1 database tables:** Run `schema.sql` instead of the migration. Do not run both on the same newly initialized database.

The fresh schema contains these tables: `users`, `sessions`, `messages`, `threads`, `rate_limits`, `email_challenges`, and `recovery_tickets`.

### Deployment (GitHub + Cloudflare Pages)

1. Extract `ScAry Net.zip` and upload the **contents** of the `ScAry Net/` folder to the GitHub repository root. Do not upload only the ZIP.
2. In Cloudflare Pages, connect the repository. Use framework **None**, build command `exit 0`, and output folder **`public`** (repository root is `/`).
3. Create or select your D1 database `scary-net-db`, initialize/migrate as explained above.
4. Under Pages **Settings → Bindings**, add a D1 database binding with the exact name **`DB`** pointing to `scary-net-db`. Redeploy.
5. Configure the three email variables/secrets, redeploy, then test email registration, verification, recovery, account settings, and two-account messaging.

**Use VS Code Live Server only to preview the design.** It cannot run the account, chat, or email backend. Use the deployed Pages website to test complete functionality.

## Testing checklist

- Register `alice_01` with a valid email and 8–25-character password, then confirm the 8-digit verification code.
- Use the settings gear to change username to `alice_02` while providing the existing password. Log out and sign in as `alice_02` using that **same password**. Confirm earlier chat history remains.
- Change the password under settings. Log in with the new password on another device; the previous password must no longer work.
- Use **Forgot username or password?**. Check the recovery email for the username and code, verify the code, reset the password, then sign in.
- Change the recovery email using the current password. Verify the new email. Confirm the previous email is no longer authorized for recovery.
- Create another account and verify one-to-one messaging still works.

## Security notes and limitations

- Codes are single-use and expire in 15 minutes; recovery tickets expire in 10 minutes. Hashed HMAC codes and hashed recovery tickets are kept in D1, not the raw values. Attempts and email requests are rate-limited; recovery requests do not publicly confirm whether an email exists.
- The browser never sends the original plaintext password to the backend. The client proof is password-equivalent and must be protected by HTTPS; don't remove/alter the existing derivation settings. Server password hashes are PBKDF2 salted.
- Emails should be kept private: do not put them in chat user lookup, error messages, or frontend logs. Store `RESEND_API_KEY` and `RECOVERY_SECRET` as encrypted Cloudflare secrets, not in code or the GitHub repository.
- Existing accounts without verified email cannot self-recover until they sign in and verify an email. Users who do not receive verification mail should check spam and may resend through Settings (rate limited).
- This starter is **not end-to-end encrypted**. Messages remain readable to the database operator. It has no file attachments, push notifications while closed, full abuse-moderation system or guarantee of zero-cost mobile data. Hosting and email sending are subject to free-tier limits; a custom domain often costs money.
- This code is a functional starter; it has not undergone an independent security audit. Test it with a small set of trusted users before public launch.

## Official references

- Cloudflare Pages / GitHub: https://developers.cloudflare.com/pages/configuration/git-integration/
- Pages Functions & D1 binding: https://developers.cloudflare.com/pages/functions/bindings/
- D1 execute & migrations: https://developers.cloudflare.com/d1/wrangler-commands/
- Cloudflare tutorial: Resend email sending: https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/
- Resend plans: https://resend.com/pricing

The website continues to work on iPhone, Android, Windows, and Mac with internet access. Adding the site to a phone's Home Screen does not make mobile network traffic free.
