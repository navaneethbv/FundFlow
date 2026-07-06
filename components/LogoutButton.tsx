"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="text-sm font-medium text-black/60 transition-colors hover:text-black focus-visible:outline-2 dark:text-white/60 dark:hover:text-white"
    >
      Sign out
    </button>
  );
}
