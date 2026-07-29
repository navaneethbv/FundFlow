import type { ComponentType } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Calendar,
  Compass,
  Landmark,
  LayoutDashboard,
  LineChart,
  Mail,
  PiggyBank,
  Search,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
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

import type { FeatureFlag } from "@/lib/feature-flags";

export interface NavItemDefinition {
  key: NavItemKey;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  category: "primary" | "planning" | "manage";
  featureFlag?: FeatureFlag;
}

export const NAV_ITEMS: NavItemDefinition[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, category: "primary" },
  { key: "accounts", label: "Accounts", href: "/accounts", icon: Landmark, category: "primary", featureFlag: "accountsPage" },
  { key: "transactions", label: "Transactions", href: "/transactions", icon: Wallet, category: "primary" },
  { key: "cashflow", label: "Cash Flow", href: "/cash-flow", icon: ArrowLeftRight, category: "primary", featureFlag: "cashFlowPage" },
  { key: "reports", label: "Reports", href: "/reports", icon: BarChart3, category: "primary", featureFlag: "reportsPage" },
  { key: "budget", label: "Budget", href: "/budget", icon: PiggyBank, category: "planning", featureFlag: "budgetPage" },
  { key: "recurring", label: "Recurring", href: "/recurring", icon: Calendar, category: "planning", featureFlag: "recurringPage" },
  { key: "goals", label: "Goals", href: "/goals", icon: Target, category: "planning" },
  { key: "investments", label: "Investments", href: "/investments", icon: LineChart, category: "planning", featureFlag: "investmentsPage" },
  { key: "forecasting", label: "Forecasting", href: "/forecasting", icon: TrendingUp, category: "planning", featureFlag: "forecastingPage" },
  { key: "advice", label: "Advice", href: "/advice", icon: Compass, category: "planning", featureFlag: "advicePage" },
  { key: "notifications", label: "Notifications", href: "/notifications", icon: Mail, category: "manage" },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings, category: "manage" },
  { key: "wrapped", label: "Year in Money", href: "/wrapped", icon: Sparkles, category: "manage" },
];

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
