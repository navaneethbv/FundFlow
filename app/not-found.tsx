import { connection } from "next/server";
import AuthShell from "@/components/shell/AuthShell";
import ButtonLink from "@/components/ui/ButtonLink";

export default async function NotFound() {
  // Nonce-based CSP requires request-time rendering so Next can stamp scripts.
  await connection();

  return (
    <AuthShell
      title="Page not found"
      subtitle="The page you requested does not exist or has moved. Error 404."
    >
      <ButtonLink href="/dashboard" variant="primary" className="w-full">
        Back to dashboard
      </ButtonLink>
    </AuthShell>
  );
}
