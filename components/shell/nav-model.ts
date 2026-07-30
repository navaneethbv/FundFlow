import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  Mail,
  PiggyBank,
  Search,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from "@/components/ui/icons";

export type NavItemKey =
  | "dashboard"
  | "accounts"
  | "transactions"
  | "cashflow"
  | "reports"
  | "budget"
  | "recurring"
  | "goals"
  | "investments"
  | "forecasting"
  | "advice"
  | "settings"
  | "notifications"
  | "wrapped";

export type AppShellActive = NavItemKey | "monitor" | "plan" | "wealth";

import type { FeatureFlag, FeatureFlagEnv } from "@/lib/feature-flags";
import { isFeatureEnabled } from "@/lib/feature-flags";

export interface NavItemDefinition {
  key: NavItemKey;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  category: "primary" | "planning" | "manage";
  featureFlag?: FeatureFlag;
  hint: string;
}

export const NAV_ITEMS: NavItemDefinition[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, category: "primary", hint: "Monitor, plan, and wealth views" },
  { key: "accounts", label: "Accounts", href: "/accounts", icon: Landmark, category: "primary", featureFlag: "accountsPage", hint: "Grouped balances and history" },
  { key: "transactions", label: "Transactions", href: "/transactions", icon: Wallet, category: "primary", hint: "Ledger" },
  { key: "cashflow", label: "Cash Flow", href: "/cash-flow", icon: ArrowLeftRight, category: "primary", featureFlag: "cashFlowPage", hint: "Income, expenses, savings rate" },
  { key: "budget", label: "Budget", href: "/budget", icon: PiggyBank, category: "planning", featureFlag: "budgetPage", hint: "Monthly envelopes" },
  { key: "goals", label: "Goals", href: "/goals", icon: Target, category: "planning", hint: "Savings goals" },
  { key: "notifications", label: "Notifications", href: "/notifications", icon: Mail, category: "manage", hint: "Alerts and digests" },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings, category: "manage", hint: "Control center" },
  { key: "wrapped", label: "Year in Money", href: "/wrapped", icon: Sparkles, category: "manage", hint: "Annual recap" },
];

export function getEnabledNavItems(env?: FeatureFlagEnv): NavItemDefinition[] {
  return NAV_ITEMS.filter((item) => !item.featureFlag || isFeatureEnabled(item.featureFlag, env));
}

export interface UtilityItemDefinition {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  action?: "search" | "notifications" | "settings";
}

export const UTILITY_ITEMS: UtilityItemDefinition[] = [
  { key: "search", label: "Search (⌘K)", icon: Search, action: "search" },
  { key: "notifications", label: "Notifications", icon: Mail, action: "notifications" },
  { key: "settings", label: "Settings", icon: Settings, action: "settings" },
];
