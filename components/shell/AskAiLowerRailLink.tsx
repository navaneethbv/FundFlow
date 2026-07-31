import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAskAiAvailable } from "@/lib/ai-gate";
import { Sparkles } from "@/components/ui/icons";

export default async function AskAiLowerRailLink() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isAskAiAvailable(supabase, user.id))) return null;

  return (
    <Link
      href="/settings?section=integrations"
      title="Ask your money"
      className="mt-4 inline-flex w-full items-center gap-3 rounded-field px-3 py-2.5 text-sm font-semibold text-muted transition-colors duration-150 hover:bg-panel-hover hover:text-foreground focus-visible:outline-2 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
    >
      <Sparkles aria-hidden className="h-4 w-4 shrink-0" />
      <span className="group-data-[collapsed=true]/sidebar:sr-only">Ask your money</span>
    </Link>
  );
}
