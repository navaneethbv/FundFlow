# FundFlow Passkeys and MFA Recovery Design

## Security model

Passkeys are a phishing-resistant first-factor sign-in method provided by Supabase Auth.
They do not replace FundFlow's TOTP second-factor policy.
After password, OAuth, or passkey sign-in, the existing `needsMfaStepUp` check still requires a verified Supabase MFA factor whenever `nextLevel` is AAL2.

Static application backup codes will not be implemented because Supabase cannot use them to elevate a session to AAL2.
Recovery uses multiple named Supabase TOTP factors, which preserves the existing AAL invariant.
The unused `mfa_backup_codes` table, grants, policies, indexes, and tests will be removed by migration.

## Supabase configuration

The browser client will explicitly enable Supabase's experimental passkey API.
The installed `@supabase/supabase-js` version already satisfies the required version floor.

Local Supabase configuration will enable passkeys with display name `FundFlow`, relying-party id `localhost`, and origin `http://localhost:3000`.
The linked production project will use relying-party id `fund-flow-swart.vercel.app` and origin `https://fund-flow-swart.vercel.app`.
Changing the production relying-party id after enrollment would invalidate existing passkeys, so this value is treated as a permanent deployment setting.

Vercel preview domains cannot share that relying-party id safely.
The preview UI will explain that passkey enrollment and sign-in are available only on the canonical production domain.
Unit and component tests will cover preview behavior, while the real WebAuthn ceremony will be verified manually on production after deployment.

## Passkey sign-in

The Login page will offer Use a passkey without requiring an email address.
Successful passkey sign-in enters the same post-authentication AAL evaluation used by password and OAuth sign-in.
If a verified TOTP factor exists, the user must complete TOTP before accessing private pages or APIs.
Cancellation, unsupported browser, disabled project configuration, and verification failure will produce distinct, non-sensitive messages.

## Passkey management

The Security settings page will list the current user's passkeys with friendly name, created time, and last-used time when available.
Users can register, rename, and delete their own passkeys through Supabase Auth.
Registration requires an existing confirmed, non-anonymous session.
Deleting the final passkey does not affect password or OAuth sign-in.

Passkey-management audit events record action and passkey id only.
Credential material, challenges, and WebAuthn responses are never logged or stored in application tables.

## TOTP recovery factors

The existing MFA component will support up to ten verified Supabase TOTP factors.
Each factor receives a friendly name such as Primary phone or Backup authenticator during enrollment.
Supabase does not expose a TOTP-factor rename operation, so changing that name requires enrolling and verifying a replacement before removing the old factor.
Enrollment displays the secret and QR code only during the Supabase enrollment ceremony.
The factor is not treated as usable until challenge verification succeeds.

Users may unenroll one verified factor only from an AAL2 session.
The UI will warn before removing the final verified TOTP factor because doing so removes the account's second-factor requirement.
FundFlow will recommend keeping a second factor on a different device or password manager.

The `profiles.mfa_enrolled` compatibility flag remains a derived cache of whether at least one verified factor exists.
Every enroll, verify, and unenroll action writes a non-sensitive audit event.

## API behavior

The current MFA audit route will be extended rather than creating a parallel credential store.
It will validate factor ownership through Supabase Auth, require AAL2 for unenroll operations, and update `profiles.mfa_enrolled` after verified-factor changes.
No service client will create, inspect, or simulate TOTP factors.

## Verification

Unit tests will cover passkey hostname availability, login state transitions, AAL2 step-up after passkey sign-in, multiple-factor rendering, final-factor warnings, and audit metadata.
Integration tests will prove AAL1 requests still receive 401 responses when a verified factor exists.
Credentialed browser tests will cover multiple TOTP-factor enrollment and removal without recording secrets or QR images.
Production acceptance will verify passkey register, list, rename, sign-out, sign-in, delete, and mandatory TOTP step-up.
