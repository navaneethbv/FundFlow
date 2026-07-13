import Link from "next/link";
import type { AccountSummary } from "@/lib/dashboard";
import { detectCardDesign } from "@/lib/card-design";
import { detectCardImage } from "@/lib/card-image";
import { formatCurrency, titleCase } from "@/lib/format";
import CardNetworkLogo from "@/components/dashboard/CardNetworkLogo";
import {
  dashboardHref,
  resolveDashboardView,
  type DashboardView,
} from "@/components/dashboard/dashboard-view";
import { cn } from "@/lib/cn";

function withExtraParams(
  href: string,
  extraParams?: Record<string, string | undefined>,
) {
  const params = new URLSearchParams(href.split("?")[1]);
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value) params.set(key, value);
  }
  return `/dashboard?${params.toString()}`;
}

function cardUrl({
  accountId,
  selectedAccountId,
  activeView,
  selectedMonth,
  extraParams,
}: {
  accountId: string;
  selectedAccountId?: string;
  activeView: DashboardView;
  selectedMonth?: string;
  extraParams?: Record<string, string | undefined>;
}) {
  return withExtraParams(
    dashboardHref({
      view: activeView,
      accountId: selectedAccountId === accountId ? undefined : accountId,
      month: selectedMonth,
    }),
    extraParams,
  );
}

export default function CardCarousel({
  accounts,
  selectedAccountId,
  selectedMonth,
  activeView,
  activeTab,
  extraParams,
}: {
  accounts: AccountSummary[];
  selectedAccountId?: string;
  selectedMonth?: string;
  activeView?: DashboardView;
  activeTab?: string;
  extraParams?: Record<string, string | undefined>;
}) {
  if (accounts.length === 0) return null;
  const view = activeView ?? resolveDashboardView({ tab: activeTab });

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="eyebrow">Cards & Accounts</h2>
        {selectedAccountId && (
          <Link
            href={withExtraParams(
              dashboardHref({ view, month: selectedMonth }),
              extraParams,
            )}
            className="text-xs font-semibold text-accent hover:underline"
          >
            Clear filter
          </Link>
        )}
      </div>
      <div className="-mx-4 flex touch-pan-x snap-x gap-4 overflow-x-auto px-4 pb-2 scrollbar-none sm:mx-0 sm:px-0">
        {accounts.map((account) => {
          const design = detectCardDesign(account.name, account.official_name, account.type, account.subtype);
          const image = detectCardImage(account.name, account.official_name, account.mask);
          const selected = selectedAccountId === account.id;
          return (
            <Link
              href={cardUrl({
                accountId: account.id,
                selectedAccountId,
                activeView: view,
                selectedMonth,
                extraParams,
              })}
              key={account.id}
              className="shrink-0 snap-start rounded-card focus-visible:outline-2"
            >
              <article
                className={cn(
                  "relative flex h-[170px] w-[292px] flex-col justify-between overflow-hidden rounded-card border bg-gradient-to-br p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-float",
                  design.bgGradient,
                  image ? "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]" : design.textColor,
                  selected ? "border-accent ring-2 ring-accent/45" : image ? "border-white/10" : design.borderColor,
                )}
              >
                {image ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image}
                      alt=""
                      aria-hidden
                      draggable={false}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/45" />
                  </>
                ) : (
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,0.18),transparent_12rem)]" />
                )}
                <div className={cn("relative flex items-start gap-4", image ? "justify-end" : "justify-between")}>
                  {!image && (
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">
                        {account.type === "credit" ? "Credit Card" : titleCase(account.subtype ?? account.type)}
                      </p>
                      <h3 className="mt-1 truncate text-base font-black">{design.displayName}</h3>
                    </div>
                  )}
                  <CardNetworkLogo network={design.network} />
                </div>
                <div className="relative">
                  <p className="text-xs font-semibold opacity-75">
                    {account.type === "credit" ? "Current Balance" : "Available Balance"}
                  </p>
                  <p className="display mt-1 text-2xl">
                    {formatCurrency(account.current_balance, account.iso_currency_code ?? "USD")}
                  </p>
                  <p className="mt-2 font-mono text-xs tracking-[0.28em] opacity-75">
                    **** {account.mask ?? "0000"}
                  </p>
                </div>
              </article>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
