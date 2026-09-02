"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearSidebarCollapsedCookie } from "@/lib/sidebar-collapsed-cookie";
import Button from "@/components/ui/Button";

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    // The next account on this browser must not inherit this one's layout.
    clearSidebarCollapsedCookie();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      onClick={signOut}
      variant="ghost"
      size="sm"
      className="whitespace-nowrap"
    >
      Sign out
    </Button>
  );
}
