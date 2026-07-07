"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface NotificationRow {
  id: string;
  type: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsSection({
  initialNotifications,
}: {
  initialNotifications: NotificationRow[];
}) {
  const supabase = createClient();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [error, setError] = useState<string | null>(null);

  async function markRead(id: string) {
    setError(null);
    const readAt = new Date().toISOString();
    const previous = notifications;
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read_at: readAt } : notification,
      ),
    );
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read_at: readAt })
      .eq("id", id);
    if (updateError) {
      setNotifications(previous);
      setError(updateError.message);
    }
  }

  return (
    <Panel title="Notifications" eyebrow="Review center">
      <div className="space-y-3 text-sm">
        {notifications.map((notification) => (
          <div key={notification.id} className="rounded-field bg-panel-2 p-3">
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="block font-semibold">{notification.title}</span>
                <span className="block text-xs text-muted">{notification.body}</span>
              </span>
              <Badge tone={notification.severity === "info" ? "neutral" : notification.severity}>
                {notification.read_at ? "read" : notification.severity}
              </Badge>
            </div>
            {!notification.read_at && (
              <Button className="mt-3" variant="ghost" size="sm" onClick={() => markRead(notification.id)}>
                Mark read
              </Button>
            )}
          </div>
        ))}
        {notifications.length === 0 && (
          <p className="py-4 text-sm text-muted">No notifications yet. Budget, bank, goal, and cash-flow alerts will appear here.</p>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
