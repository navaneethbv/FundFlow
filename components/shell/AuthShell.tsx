import type { ReactNode } from "react";
import Logo from "@/components/ui/Logo";
import ThemeToggle from "@/components/ThemeToggle";

export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10 text-foreground">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle variant="switch" />
      </div>
      <section className="w-full max-w-md rounded-card border border-panel-border bg-panel p-6 shadow-float sm:p-8">
        <div className="mb-8 text-center">
          <Logo className="justify-center" />
          <h1 className="display mt-6 text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
      </section>
    </main>
  );
}
