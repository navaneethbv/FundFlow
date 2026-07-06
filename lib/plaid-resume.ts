/**
 * Client-side handoff for resuming a Plaid Link flow across an OAuth redirect.
 *
 * OAuth banks bounce the browser to the single registered redirect_uri (the
 * dashboard), so the resume always happens there — even for a reconnect the
 * user started on the Settings page. Before opening Link, each entry point
 * stashes what it was doing here; the dashboard's ConnectBankButton reads it
 * back on return and routes onSuccess to exchange (new link) or reconnect.
 *
 * Stored in localStorage (not a cookie/state) because the flow survives a full
 * cross-origin navigation. The link_token itself is short-lived and not a
 * secret access token.
 */
const KEY = "plaid_link_resume";

export type PlaidResume =
  | { token: string; mode: "connect" }
  | { token: string; mode: "reconnect"; itemId: string };

export function saveResume(resume: PlaidResume): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(resume));
  } catch {
    // localStorage unavailable (private mode / disabled) — non-OAuth flows,
    // which complete in-page without needing the handoff, still work.
  }
}

export function loadResume(): PlaidResume | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlaidResume) : null;
  } catch {
    return null;
  }
}

export function clearResume(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
