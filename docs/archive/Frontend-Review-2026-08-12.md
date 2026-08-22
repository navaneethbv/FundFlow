# Frontend Review: Settings and Plaid Security Hardening

Date: 2026-08-11
Branch reviewed: `main` (a9088e9..d7d682d, the security hardening merge)
Reviewer: automated frontend review

## Scope

Five frontend files changed in this merge:

- `components/settings/DangerZone.tsx`: added re-authentication step-up (TOTP or password) before account deletion.
- `components/ConnectBankButton.tsx`: sends `link_token` with the token exchange so the server can bind ownership.
- `components/settings/BanksSection.tsx`: share checkbox now posts an explicit `householdId`; prop changed from `hasHousehold` to `householdId`.
- `components/settings/PasskeysSection.tsx`: passkey delete moved server-side; the audit call became `recordPasskeyChange`.
- `app/settings/page.tsx`: passes `householdId` (newest household) into `BanksSection`.

Cross-checked against the API contracts in `app/api/account`, `app/api/plaid/exchange`, `app/api/plaid/share`, `app/api/plaid/disconnect`, and `app/api/settings/passkeys`.
`npx tsc --noEmit` and `npx eslint` on all five files are clean.

## What looks good

- The step-up method is decided server-side from enrolled factors, so a stolen session cannot downgrade an MFA account to password confirmation.
- The `link_token` is threaded through the whole exchange flow, including the OAuth bounce resume path, and the server treats it as single-use.
- The share route requires an explicit household and verifies membership via RLS, closing the "share to an arbitrary household" gap.
- Passkey deletion is now performed by the server with the admin API, so the UI cannot claim a delete that did not happen.
- Link tokens are minted on click, not on mount, which avoids spending a Plaid API call per page view.
- The `wantsOpenRef` intent pattern in the Plaid buttons is correct and avoids both hydration mismatch and surprise Link reopens.

## Bugs

### B1. DangerZone: step-up form can soft-lock with no feedback (medium, introduced)

`stepUpMethod` starts as `null` until `supabase.auth.mfa.listFactors()` resolves.
If the user confirms before it resolves, or if the call fails, the form renders the password variant but `deleteAccount` returns early on `!stepUpMethod`.
The submit button is only disabled on empty `code`, so the user clicks "Confirm deletion" and nothing happens, with no error shown.
If `listFactors` fails, the form is permanently dead for the session.

Suggested fix: on `listFactors` failure, set an error or fall back to `"password"`; disable submit while `stepUpMethod` is `null`.

### B2. ConnectBankButton: a spent link token is reused for the next connect (medium, pre-existing)

After a successful exchange, `onSuccess` calls `clearResume()` but never clears the `linkToken` or `resume` state.
`router.refresh()` preserves client state, so a second "Connect a bank" click in the same session takes the `if (linkToken)` branch and calls `open()` with a token Plaid has already completed.
Plaid link tokens are single-use after success, so Link opens into an error state, and there is no `onExit` handler to surface or recover from it.
This button renders on the dashboard header, dashboard toolbar, and accounts page, so it is easy to hit.

Suggested fix: `setLinkToken(null)` and `setResume(null)` on success, and add an `onExit` handler that maps Plaid errors into the component error state.

### B3. ConnectBankButton: stale `oauth_state_id` shows a spurious error on reload (low, pre-existing)

The mount effect keys off `oauth_state_id` in the URL, but after a successful resume the parameter is never stripped.
Reloading or restoring the tab then hits `loadResume() === null` and shows "Bank connection expired. Please start again." even though the connection succeeded.

Suggested fix: after consuming the resume (success or failure), `router.replace` to the same path without the query string.

### B4. PasskeysSection: register can report failure after the passkey exists (low, introduced)

For register, the browser ceremony completes first and `recordPasskeyChange("register", id)` runs after.
If that POST fails (network error, or the admin `listPasskeys` lagging behind the ceremony and returning "Passkey not found"), the catch shows "Could not record the passkey change." and does not reload the list.
The passkey actually exists in Supabase Auth, so the list is stale and a retry creates a duplicate.
The comment "a non-2xx means the change was NOT made" is only true for delete.

Suggested fix: on register-record failure, still call `loadPasskeys()` and word the error as "the passkey may have been added; refresh the list".

### B5. BanksSection: placeholder string `"shared"` stored in the id field (low, introduced)

The optimistic update writes `shared_household_id: share ? (json?.householdId ?? "shared") : null`.
The literal `"shared"` is not a household id; it only works because the UI reads the field with `Boolean()`.
Any future use of the value (display, refetch diffing, posting back) would carry a bogus id.

Suggested fix: the route always returns `householdId` on a successful share, so trust it, or track sharing as separate boolean state.

### B6. BanksSection: share checkbox has no in-flight guard (low, introduced)

Rapid toggles fire overlapping POSTs.
The server applies the last write, but the checkbox reflects only the last successful response, so UI and server can desync.
There is also no visual feedback while the request is pending.

Suggested fix: track a `sharingId` busy state and disable the checkbox while its request is in flight.

## Modifications and improvements

### M1. Remove the dead `method` field from the DELETE body (cleanup)

`DangerZone` posts `{ method: stepUpMethod, code }`, but the route deliberately ignores `method` and decides server-side.
Sending it implies client influence that does not exist; drop it from the payload.

### M2. Move `signOut` out of the deletion try block (low)

In `DangerZone`, if `supabase.auth.signOut()` throws after the account is already deleted, the catch shows an error and re-enables the button even though the account is gone.
Make signOut and the redirect best-effort, outside the try, or swallow signOut failure explicitly.

### M3. Name the share target household (moderate UX)

The settings page passes the newest household (`order(created_at desc).limit(1)`) and the checkbox label just says "Share with household".
For multi-household users this is a silent, arbitrary target.
Show the household name in the label, or render a selector when the user belongs to more than one.
The same "newest household" pattern feeds `BudgetsSection`, so decide the convention once.

### M4. Standardize error text styling and announcements (low)

`PasskeysSection` uses `role="alert"` and the `text-danger` design token.
`DangerZone` and `BanksSection` render errors as a plain `<p>` with raw `text-red-600`, which is not theme-aware (themes redefine `--danger`) and is not announced to screen readers.
Use the token and `role="alert"`, or route errors through `Field`'s error slot.
Note: `text-red-600` is widespread in older settings sections, so this is a convention to standardize, not a regression.

### M5. Reconsider the post-deletion destination (UX question)

After deletion the user is pushed to `/signup`.
A signed-out landing or a short "account deleted" confirmation would read better than a registration form.

### M6. PasskeysSection small UX nits (low)

- The rename input is not wrapped in a form, so Enter does not submit.
- `rename` returns silently on an empty name; give feedback or disable Save.
- A single shared `loading` state spins every row's buttons during any one-row action; track busy per passkey id.

### M7. API body key conventions are inconsistent (cosmetic)

`/api/plaid/share` takes `itemId`, while `/api/plaid/disconnect` and `/api/plaid/reconnect` take `item_id`.
Pick one convention for the Plaid routes.

### M8. Double confirmation in DangerZone (design choice, noting)

The flow is native `confirm()` dialog, then an inline step-up form.
For account deletion the extra friction is defensible, but the native dialog is inconsistent with the rest of the design system; an inline confirm step would look more intentional.

## Suggested priority

1. B1 (bricked delete form) and B2 (spent token reuse), both user-visible dead ends.
2. B4 and M3, correctness and clarity around data the user cares about.
3. B3, B5, B6, M1, M2, small hardening and cleanup.
4. M4 through M8, polish and conventions.
