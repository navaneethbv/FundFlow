"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Web push opt-in: alerts land as browser notifications even when the app
 * is closed. Requires NEXT_PUBLIC_VAPID_PUBLIC_KEY; hidden without it.
 */
export default function PushSection() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    let active = true;
    // Deferred (ThemeToggle pattern) so setState never runs synchronously
    // inside the effect.
    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      setSupported(true);
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (active) setSubscribed(Boolean(subscription));
      } catch {
        // Ignore — the enable button will surface real failures.
      }
    });
    return () => {
      active = false;
    };
  }, [publicKey]);

  if (!publicKey || !supported) return null;

  async function enable() {
    setStatus(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Notifications were blocked by the browser.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(publicKey!),
      });
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error("subscribe failed");
      setSubscribed(true);
      setStatus("Push notifications enabled on this device.");
    } catch {
      setStatus("Could not enable push notifications.");
    }
  }

  async function disable() {
    setStatus(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setStatus("Push notifications disabled on this device.");
    } catch {
      setStatus("Could not disable push notifications.");
    }
  }

  return (
    <Panel title="Push notifications" eyebrow="This device">
      <p className="mb-4 text-sm text-muted">
        Get alerts as browser notifications even when FundFlow isn&apos;t
        open — price hikes, large charges, low-cash warnings.
      </p>
      {subscribed ? (
        <Button onClick={disable} variant="ghost" size="md">
          Disable on this device
        </Button>
      ) : (
        <Button onClick={enable} size="md">
          Enable push notifications
        </Button>
      )}
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
