import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { Mail } from "@/components/ui/icons";

export default async function NotificationsBell() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const unread = user ? await getUnreadNotificationCount(supabase, user.id) : 0;

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
    >
      <Mail aria-hidden className="h-3.5 w-3.5" />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.6rem] font-bold text-white"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
