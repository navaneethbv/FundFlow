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
      className="inline-flex h-9 w-full items-center justify-center gap-3 rounded-field px-0 text-base font-medium text-accent transition-colors duration-150 hover:bg-panel-hover focus-visible:outline-2 lg:justify-start lg:px-3 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
    >
      <Sparkles aria-hidden className="h-4 w-4 shrink-0" />
      <span className="sr-only lg:not-sr-only group-data-[collapsed=true]/sidebar:sr-only">
        Ask your money
      </span>
    </Link>
  );
}
