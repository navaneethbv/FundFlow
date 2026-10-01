import AuthShell from "@/components/shell/AuthShell";
import Button from "@/components/ui/Button";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join household", robots: { index: false, follow: false } };

export default async function AcceptHouseholdPage({ searchParams }: Readonly<{
  searchParams: Promise<{ token?: string }>;
}>) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && token.length >= 20 && token.length <= 256;
  return <AuthShell title="Join a household" subtitle="Review before accepting this invitation.">
    {valid ? <form action={`/api/household/accept?token=${encodeURIComponent(token)}`} method="post" className="space-y-4">
      <p className="text-sm text-muted">Joining adds your account to this household. Household members can see financial information you choose to share. Accept only if you recognize the person who invited you.</p>
      <Button type="submit">Accept invitation</Button>
    </form> : <p role="alert">This invitation link is invalid.</p>}
    <Link href="/settings" className="mt-4 inline-block text-sm underline">Cancel</Link>
  </AuthShell>;
}
