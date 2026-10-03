export type ExternalService = {
  key: "supabase" | "plaid" | "email" | "web-push" | "anthropic";
  name: string;
  purpose: string;
  dataSent: string;
  trigger: string;
  optionality: "Required" | "Optional" | "Opt-in";
  sourceFiles: string[];
};

/**
 * The privacy registry is intentionally source-linked rather than inferred
 * from package names. Each row names the call boundary that must be reviewed
 * when a provider or payload changes.
 */
export const EXTERNAL_SERVICES: readonly ExternalService[] = [
  {
    key: "supabase",
    name: "Supabase",
    purpose: "Authentication, database queries, private storage, and realtime app state.",
    dataSent: "Your account session, profile settings, financial records, and files required by the requested operation.",
    trigger: "Sign-in, page loads, app writes, file access, and background jobs.",
    optionality: "Required",
    sourceFiles: ["lib/supabase/server.ts", "lib/supabase/client.ts", "lib/supabase/service.ts"],
  },
  {
    key: "plaid",
    name: "Plaid",
    purpose: "Connect supported financial institutions and sync account, balance, and transaction data.",
    dataSent: "Plaid access credentials and institution/account sync requests; Plaid returns the connected financial data.",
    trigger: "Only when you connect, refresh, repair, or disconnect a bank connection; Plaid Link loads on demand.",
    optionality: "Optional",
    sourceFiles: ["lib/plaid.ts", "lib/sync.ts", "components/ConnectBankButton.tsx", "app/layout.tsx"],
  },
  {
    key: "email",
    name: "Configured email delivery (SMTP / Resend-compatible)",
    purpose: "Deliver account alerts, reports, invitations, backup files, and operational notices.",
    dataSent: "Recipient email address and the message body or attachment selected by the notification.",
    trigger: "A matching notification, report, invite, backup, or login event when email delivery is configured and enabled.",
    optionality: "Optional",
    sourceFiles: ["lib/reporting.ts", "app/api/cron/sync/route.ts", "app/api/cron/backup/route.ts", "app/api/household/invite/route.ts"],
  },
  {
    key: "web-push",
    name: "Browser push service",
    purpose: "Deliver optional in-app notification mirrors to subscribed browsers.",
    dataSent: "The browser's push endpoint and encrypted title/body notification payload; no transaction rows are sent.",
    trigger: "Only when you subscribe a browser and a notification is generated; delivery is skipped without VAPID configuration.",
    optionality: "Optional",
    sourceFiles: ["lib/push.ts", "components/notifications/PushSection.tsx"],
  },
  {
    key: "anthropic",
    name: "Anthropic",
    purpose: "Generate opt-in spending insights, answers, and receipt extraction.",
    dataSent: "Only the bounded aggregate or receipt payload allowed by the selected AI feature; not account names, balances, emails, or transaction-level rows.",
    trigger: "Only after AI consent and the related export preference are enabled, then an AI insight, answer, or receipt scan is requested.",
    optionality: "Opt-in",
    sourceFiles: ["lib/ai-provider.ts", "app/api/ai/ask/route.ts", "app/api/ai/insights/route.ts", "app/api/ai/receipt/route.ts"],
  },
] as const;
