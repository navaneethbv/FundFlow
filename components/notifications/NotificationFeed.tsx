"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

export interface NotificationRow {
  id: string;
  type: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationFeed({ initialNotifications }: { initialNotifications: NotificationRow[] }) {
  const supabase = createClient();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [error, setError] = useState<string | null>(null);

  async function markRead(id: string) {
    setError(null);
    const readAt = new Date().toISOString();
    const previous = notifications;
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: readAt } : item));
    const { error: updateError } = await supabase.from("notifications").update({ read_at: readAt }).eq("id", id);
    if (updateError) {
      setNotifications(previous);
      setError(updateError.message);
    }
  }

  return (
    <Panel title="Recent notifications" eyebrow="Activity feed" padding="lg">
      <div className="space-y-3">
        {notifications.map((notification) => (
          <article key={notification.id} className="rounded-field border border-panel-border bg-panel-2 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{notification.title}</h3>
                  <Badge tone={notification.severity === "info" ? "neutral" : notification.severity}>
                    {notification.read_at ? "read" : notification.severity}
                  </Badge>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted">{notification.body}</p>
                <time className="mt-2 block text-xs text-muted" dateTime={notification.created_at}>
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(notification.created_at))}
                </time>
              </div>
              {!notification.read_at && (
                <Button variant="ghost" size="sm" type="button" onClick={() => markRead(notification.id)}>Mark read</Button>
              )}
            </div>
          </article>
        ))}
        {notifications.length === 0 && (
          <div className="rounded-field border border-dashed border-panel-border px-4 py-8 text-center">
            <p className="text-sm font-semibold">You are all caught up.</p>
            <p className="mt-1 text-xs text-muted">New budget, bank, goal, and cash-flow signals will appear here.</p>
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
