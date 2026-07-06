import { connection } from "next/server";
import AuthShell from "@/components/shell/AuthShell";
import ButtonLink from "@/components/ui/ButtonLink";

export default async function NotFound() {
  // Nonce-based CSP requires request-time rendering so Next can stamp scripts.
  await connection();

  return (
    <AuthShell title="404" subtitle="The page you requested does not exist.">
      <ButtonLink href="/dashboard" className="w-full">
        Back to dashboard
      </ButtonLink>
    </AuthShell>
  );
}
