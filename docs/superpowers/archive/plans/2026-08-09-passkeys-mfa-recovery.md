# Passkeys and MFA Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase passkeys as a first-factor sign-in option and replace unusable application backup codes with multiple named Supabase TOTP recovery factors.

**Architecture:** Supabase Auth remains the only credential store.
The browser client enables the experimental passkey surface, sign-in rejoins the existing AAL evaluation, Settings manages user-owned passkeys and TOTP factors, and a migration removes the unused backup-code table.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript 6, `@supabase/supabase-js` 2.111.0, Supabase Auth, Vitest 4, and Playwright 1.61.

## Global Constraints

The work remains on `fix/shipped-defects` and PR #99.
Passkeys are a first factor and never bypass the existing TOTP AAL2 requirement.
No service client creates, reads, verifies, or simulates TOTP credentials.
Credential material, passkey challenges, WebAuthn responses, TOTP secrets, and QR payloads never enter logs, audit metadata, screenshots, or application tables.
Production relying-party id `fund-flow-swart.vercel.app` is treated as permanent.

---

### Task 1: Remove the unsupported backup-code store

**Files:**

- Create with Supabase CLI: migration slug `remove_mfa_backup_codes`
- Modify: `tests/unit/roadmap-schema-completion.test.ts`
- Modify: `tests/integration/roadmap-rls.test.ts`
- Modify: tests that currently assert backup-code grants or policies

**Interfaces:** Removes `mfa_backup_codes` and all dependent grants, policies, indexes, functions, and obsolete test expectations.

- [ ] Write a failing schema assertion that the backup-code table and its dependent database objects do not exist.
- [ ] Run the focused schema tests and confirm failure.
- [ ] Generate the migration with the Supabase CLI and drop dependent objects before dropping the table.
- [ ] Remove obsolete RLS expectations without weakening the MFA integration tests.
- [ ] Apply the migration through the linked direct-query workflow and verify the table, policies, indexes, and grants are absent.
- [ ] Run focused tests and commit with `fix(auth): remove unusable backup code store`.

### Task 2: Configure passkeys and define availability

**Files:**

- Modify: `supabase/config.toml`
- Modify: `lib/supabase/client.ts`
- Create: `lib/passkeys.ts`
- Create: `tests/unit/passkeys.test.ts`
- Modify: browser-client tests selected by the changed module

**Interfaces:** Produces `getPasskeyAvailability(hostname, secureContext)` and a browser Supabase client with `{ auth: { experimental: { passkey: true } } }`.

- [ ] Write failing tests for localhost, canonical production, preview hosts, insecure contexts, unsupported browsers, and disabled project configuration.
- [ ] Run focused tests and confirm failure.
- [ ] Enable local passkeys with display name FundFlow, relying-party id `localhost`, and origin `http://localhost:3000`.
- [ ] Enable the installed Supabase browser client's experimental passkey option without changing server clients.
- [ ] Implement a deterministic availability helper that allows only localhost and the canonical production host and returns user-facing reasons for every blocked state.
- [ ] Configure the linked production project with display name FundFlow, relying-party id `fund-flow-swart.vercel.app`, and canonical HTTPS origin through the supported management workflow.
- [ ] Read the production configuration back without printing secrets and verify exact relying-party id and origin.
- [ ] Run focused tests and commit with `feat(auth): configure Supabase passkeys`.

### Task 3: Add passkey sign-in with MFA step-up

**Files:**

- Modify: `components/auth/LoginForm.tsx`
- Modify: `app/login/page.tsx` if page data is required
- Modify: `lib/auth-flow.ts` or the existing post-auth helper selected during implementation
- Create: `tests/unit/passkey-login.test.tsx`
- Modify: existing login and MFA tests selected by the changed modules

**Interfaces:** Adds email-free `supabase.auth.signInWithPasskey()` and sends successful sessions through the existing AAL evaluation.

- [ ] Write failing tests for success, cancellation, unsupported browser, preview domain, disabled project configuration, verification failure, and pending state.
- [ ] Add a test proving passkey success still redirects to TOTP challenge when `needsMfaStepUp` reports AAL2.
- [ ] Run focused tests and confirm failure.
- [ ] Add `Use a passkey` without an email requirement and disable competing submission while the ceremony is active.
- [ ] Map browser and Supabase failures to distinct non-sensitive messages without exposing credential data.
- [ ] Reuse the existing post-authentication AAL evaluation used by password and OAuth sign-in.
- [ ] Run login and MFA tests and commit with `feat(auth): add passkey sign in`.

### Task 4: Add passkey management to Security settings

**Files:**

- Modify: `components/settings/PasskeysSection.tsx`
- Modify: `app/settings/page.tsx`
- Create: `tests/unit/passkeys-section.test.tsx`
- Modify: `lib/audit.ts`
- Modify: the existing auth audit route if client-side audit reporting is required

**Interfaces:** Lists, registers, renames, and deletes the current user's passkeys through `supabase.auth.passkey`.

- [ ] Write failing tests for list, empty state, registration, rename, deletion, final-passkey deletion, preview-domain messaging, cancellation, retry, and audit metadata.
- [ ] Run focused tests and confirm failure.
- [ ] List friendly name, created time, and last-used time only when Supabase returns those fields.
- [ ] Register with `supabase.auth.registerPasskey()` from a confirmed non-anonymous session.
- [ ] Rename with `supabase.auth.passkey.update({ passkeyId, friendlyName })` and delete with `supabase.auth.passkey.delete({ passkeyId })`.
- [ ] Record action and passkey id only in audit events.
- [ ] Run focused tests and commit with `feat(auth): manage passkeys in settings`.

### Task 5: Support multiple named TOTP recovery factors

**Files:**

- Modify: `components/settings/MfaSection.tsx`
- Modify: the existing MFA audit route
- Modify: `lib/audit.ts`
- Create: `tests/unit/mfa-multiple-factors.test.tsx`
- Modify: existing MFA route and AAL tests

**Interfaces:** Supports up to ten verified named TOTP factors and derives `profiles.mfa_enrolled` from the verified-factor list.

- [ ] Write failing tests for multiple-factor rendering, friendly-name enrollment, pending-factor cleanup, verified-factor count, ten-factor limit, AAL2-required unenroll, final-factor warning, and derived profile state.
- [ ] Add a test proving a name change is modeled as replacement enrollment and verification before old-factor removal.
- [ ] Run focused tests and confirm failure.
- [ ] Enroll with `mfa.enroll({ factorType: 'totp', friendlyName })` and treat the factor as usable only after challenge verification.
- [ ] Keep the secret and QR payload only in ceremony-local state and clear them after completion or cancellation.
- [ ] Require AAL2 before unenrolling a verified factor and warn clearly before removing the final factor.
- [ ] Recompute `profiles.mfa_enrolled` after verified-factor changes and write non-sensitive enroll, verify, and unenroll audit events.
- [ ] Run focused tests and commit with `feat(auth): add multiple TOTP recovery factors`.

### Task 6: Verify production authentication behavior

**Files:**

- Create: `tests/e2e/mfa-recovery.spec.ts`
- Modify: Settings and login E2E tests selected during implementation
- Modify: `docs/HANDOFF.md`
- Modify: `docs/TODO.md`

- [ ] Run `npx tsc --noEmit`, `npm run lint`, affected unit suites, complete Vitest, production build, and `git diff --check`.
- [ ] Run browser coverage for preview availability messaging and multiple TOTP enrollment and removal without recording secrets or QR images.
- [ ] Deploy the final branch and manually verify production passkey register, list, rename, sign-out, sign-in, delete, and mandatory TOTP step-up.
- [ ] Verify an AAL1 session still receives 401 from protected APIs when a verified TOTP factor exists.
- [ ] Record the migration id, production configuration verification, exact test totals, browser results, and manual ceremony result.
- [ ] Commit with `docs: record passkey and MFA recovery completion`.
