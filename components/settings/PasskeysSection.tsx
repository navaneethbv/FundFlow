"use client";

import { useCallback, useEffect, useState } from "react";
import type { PasskeyListItem } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getPasskeyAvailability, passkeyErrorMessage } from "@/lib/passkeys";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

async function recordPasskeyChange(action: "register" | "rename" | "delete", passkeyId: string) {
  // For delete the server performs the actual removal (via the admin passkey
  // API) after verifying the passkey exists; for register/rename the browser
  // has already run the WebAuthn ceremony and the server just confirms and
  // audits. Either way, a non-2xx means the change was NOT made.
  const response = await fetch("/api/settings/passkeys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, passkeyId }),
  });
  if (!response.ok) throw new Error("Could not record the passkey change.");
}

function formatPasskeyTime(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export default function PasskeysSection() {
  const [supabase] = useState(createClient);
  const [passkeys, setPasskeys] = useState<PasskeyListItem[]>([]);
  const [friendlyName, setFriendlyName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState({
    available: false,
    reason: "Checking passkey availability..." as string | null,
  });

  const loadPasskeys = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.passkey.list();
    if (listError) throw listError;
    setPasskeys(data ?? []);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const next = getPasskeyAvailability(window.location.hostname, window.isSecureContext, {
        browserSupported:
          "credentials" in navigator && window.PublicKeyCredential !== undefined,
      });
      setAvailability(next);
      if (next.available) {
        void loadPasskeys().catch(() => setError("Passkeys could not be loaded. Please retry."));
      }
    });
    return () => {
      active = false;
    };
  }, [loadPasskeys]);

  async function register() {
    const name = friendlyName.trim();
    if (!name) {
      setError("Enter a name that identifies this device or password manager.");
      return;
    }
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user || userData.user.is_anonymous) {
        throw new Error("A confirmed account session is required to add a passkey.");
      }
      const { data, error: registerError } = await supabase.auth.registerPasskey();
      if (registerError) throw registerError;
      const { error: updateError } = await supabase.auth.passkey.update({
        passkeyId: data.id,
        friendlyName: name,
      });
      if (updateError) throw updateError;
      await recordPasskeyChange("register", data.id);
      setFriendlyName("");
      setStatus("Passkey added.");
      await loadPasskeys();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function rename(passkeyId: string) {
    const name = editName.trim();
    if (!name) return;
    setError(null);
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.passkey.update({
        passkeyId,
        friendlyName: name,
      });
      if (updateError) throw updateError;
      await recordPasskeyChange("rename", passkeyId);
      setEditingId(null);
      setEditName("");
      setStatus("Passkey renamed.");
      await loadPasskeys();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function remove(passkeyId: string) {
    const finalWarning = passkeys.length === 1
      ? "This is your final passkey. Password and Google sign-in will still work. Delete it?"
      : "Delete this passkey?";
    if (!window.confirm(finalWarning)) return;
    setError(null);
    setLoading(true);
    try {
      await recordPasskeyChange("delete", passkeyId);
      setStatus("Passkey deleted.");
      await loadPasskeys();
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Passkeys" eyebrow="Phishing-resistant sign-in">
      {!availability.available ? (
        <p className="text-sm text-muted">{availability.reason}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Use Face ID, Touch ID, Windows Hello, or your password manager to sign in without
            entering an email or password. TOTP verification is still required when enabled.
          </p>
          {passkeys.length === 0 ? (
            <p className="rounded-field bg-panel-2 p-3 text-sm text-muted">No passkeys added yet.</p>
          ) : (
            <ul className="space-y-2">
              {passkeys.map((passkey) => {
                const created = formatPasskeyTime(passkey.created_at);
                const lastUsed = formatPasskeyTime(passkey.last_used_at);
                return (
                  <li key={passkey.id} className="rounded-field bg-panel-2 p-3">
                    {editingId === passkey.id ? (
                      <div className="flex flex-wrap gap-2">
                        <Input
                          aria-label="New passkey name"
                          maxLength={120}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                        <Button size="sm" loading={loading} onClick={() => rename(passkey.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{passkey.friendly_name ?? "Passkey"}</p>
                          <p className="text-xs text-muted">
                            {created ? `Added ${created}` : "Added date unavailable"}
                            {lastUsed ? ` · Last used ${lastUsed}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(passkey.id);
                              setEditName(passkey.friendly_name ?? "");
                            }}
                          >
                            Rename
                          </Button>
                          <Button size="sm" variant="danger" loading={loading} onClick={() => remove(passkey.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Passkey name"
              placeholder="MacBook Touch ID"
              maxLength={120}
              value={friendlyName}
              onChange={(event) => setFriendlyName(event.target.value)}
            />
            <Button loading={loading} variant="secondary" onClick={register}>
              Add passkey
            </Button>
          </div>
        </div>
      )}
      {status && <output className="mt-3 block text-sm text-success">{status}</output>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
