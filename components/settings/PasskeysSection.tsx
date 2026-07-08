"use client";

import { useState } from "react";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";

export default function PasskeysSection() {
  const [status, setStatus] = useState<string | null>(null);

  async function checkSupport() {
    if (!("credentials" in navigator) || !window.PublicKeyCredential) {
      setStatus("This browser does not expose WebAuthn passkeys.");
      return;
    }
    setStatus("This browser supports passkeys. Supabase passkey enrollment can be enabled without weakening MFA step-up checks.");
  }

  return (
    <Panel title="Passkeys and backup codes" eyebrow="Account recovery">
      <p className="text-sm text-muted">
        Passkeys sit alongside email and TOTP. Server-side MFA enforcement remains in `requireUser`
        and `proxy.ts`, so recovery paths cannot bypass step-up checks.
      </p>
      <Button className="mt-4" variant="secondary" onClick={checkSupport}>
        Check passkey support
      </Button>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
