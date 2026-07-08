"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface SessionRow {
  id: string;
  label: string;
  current: boolean;
}

export default function SessionsSection({ initialSessions }: { initialSessions: SessionRow[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [status, setStatus] = useState<string | null>(null);

  async function revoke(id: string) {
    setStatus(null);
    const res = await fetch("/api/settings/sessions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(json.error ?? "Could not revoke session.");
      return;
    }
    setSessions((current) => current.filter((session) => session.id !== id));
    setStatus("Session revoked.");
  }

  return (
    <Panel title="Active sessions" eyebrow="Devices">
      {sessions.length === 0 ? (
        <p className="text-sm text-muted">No tracked sessions yet. New sessions appear after server activity.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
              <span>
                {session.label}
                {session.current && <span className="ml-2 text-xs text-muted">current</span>}
              </span>
              {!session.current && (
                <Button size="sm" variant="danger" onClick={() => revoke(session.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
