"use client";

import { useState } from "react";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";

export default function PasskeysSection() {
  const [status, setStatus] = useState<string | null>(null);

  function checkSupport() {
    if (!("credentials" in navigator) || !window.PublicKeyCredential) {
      setStatus("This browser does not support passkeys.");
      return;
    }
    setStatus("This browser supports passkeys, so you will be able to use them once FundFlow adds them.");
  }

  return (
    <Panel title="Passkeys" eyebrow="Not yet available">
      <p className="text-sm text-muted">
        FundFlow does not support passkeys or backup codes yet. Sign-in today is email and password
        or Google, with a TOTP authenticator app as the second factor. You can check whether this
        browser would support passkeys when they arrive.
      </p>
      <Button className="mt-4" variant="secondary" onClick={checkSupport}>
        Check passkey support
      </Button>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
