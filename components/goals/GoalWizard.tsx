"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { ChevronLeft, X } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/client";
import { GOAL_TEMPLATES, goalImageFor } from "@/lib/goal-templates";
import type { GoalType } from "@/lib/goals-v2";
import { useDialogFocus } from "@/lib/use-dialog-focus";

/**
 * The four-step goal wizard: Select → Targets → Contribution → Budget.
 *
 * The draft is mirrored into sessionStorage on every change, so a reload or an
 * accidental navigation mid-wizard resumes where the user left off instead of
 * throwing away four screens of typing. Cancelling asks first whenever the
 * draft has anything in it, and clears the stored copy when confirmed —
 * otherwise "cancel" would leave a ghost draft to reappear later.
 */

const DRAFT_KEY = "fundflow.goal-wizard.draft";

export interface WizardAccount {
  id: string;
  name: string;
  currentBalance: number | null;
  type: string | null;
}

interface Draft {
  step: number;
  slug: string | null;
  name: string;
  targetAmount: string;
  targetDate: string;
  monthlyContribution: string;
  spendingReduces: boolean;
  goalType: GoalType;
  accountId: string;
  allocationMode: "none" | "fixed" | "entire";
  allocationAmount: string;
  /**
   * The goal row already created from this draft. Once the goal exists, a
   * failed account link must not insert a second goal on retry; the retry
   * reuses this id and only retries the allocation.
   */
  createdGoalId: string | null;
}

const EMPTY: Draft = {
  step: 1,
  slug: null,
  name: "",
  targetAmount: "",
  targetDate: "",
  monthlyContribution: "",
  spendingReduces: false,
  goalType: "save_up",
  accountId: "",
  allocationMode: "none",
  allocationAmount: "",
  createdGoalId: null,
};

function isDirty(draft: Draft): boolean {
  return (
    draft.slug !== null ||
    draft.name.trim() !== "" ||
    draft.targetAmount !== "" ||
    draft.targetDate !== "" ||
    draft.monthlyContribution !== ""
  );
}

const STEP_TITLES = ["Select", "Targets", "Contribution", "Budget"];

type GoalWizardProps = Readonly<{
  accounts: WizardAccount[];
  defaultGoalType?: GoalType;
}>;

function isStepValid(draft: Draft): boolean {
  if (draft.step === 2) {
    return draft.name.trim().length > 0 && Number(draft.targetAmount) > 0;
  }
  if (draft.step === 4 && draft.allocationMode === "fixed") {
    return Number(draft.allocationAmount) > 0 && draft.accountId !== "";
  }
  if (draft.step === 4 && draft.allocationMode === "entire") {
    return draft.accountId !== "";
  }
  return true;
}

function submitLabel(draft: Draft, busy: boolean): string {
  if (busy) return draft.createdGoalId ? "Linking…" : "Creating…";
  return draft.createdGoalId ? "Link account" : "Create goal";
}

function GoalWizardStepContent({
  accounts,
  draft,
  error,
  patch,
}: Readonly<{
  accounts: WizardAccount[];
  draft: Draft;
  error: string | null;
  patch: (next: Partial<Draft>) => void;
}>) {
  const selectedAccount = accounts.find((item) => item.id === draft.accountId);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <h2 className="text-lg font-semibold">{STEP_TITLES[draft.step - 1]}</h2>

      {draft.step === 1 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GOAL_TEMPLATES.map((template) => {
            const selected = draft.slug === template.slug;
            return (
              <button
                key={template.slug}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  patch({
                    slug: template.slug,
                    name: draft.name || template.label,
                    targetAmount:
                      draft.targetAmount ||
                      (template.suggestedTarget
                        ? String(template.suggestedTarget)
                        : ""),
                  })
                }
                className={`overflow-hidden rounded-card border text-left focus-visible:outline-2 ${
                  selected
                    ? "border-accent ring-2 ring-accent"
                    : "border-panel-border hover:border-accent/40"
                }`}
              >
                <Image
                  src={goalImageFor(template.slug)!}
                  alt=""
                  width={320}
                  height={200}
                  className="h-20 w-full object-cover"
                />
                <span className="block p-3">
                  <span className="block text-sm font-semibold">
                    {template.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {template.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {draft.step === 2 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">Goal name</span>
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              maxLength={120}
            />{" "}
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">Target amount</span>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={draft.targetAmount}
              onChange={(e) => patch({ targetAmount: e.target.value })}
            />
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">
              Target date (optional)
            </span>
            <Input
              type="date"
              value={draft.targetDate}
              onChange={(e) => patch({ targetDate: e.target.value })}
            />
          </label>
        </div>
      )}

      {draft.step === 3 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-xs text-muted">
              Monthly contribution (optional)
            </span>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={draft.monthlyContribution}
              onChange={(e) => patch({ monthlyContribution: e.target.value })}
            />
            <span className="mt-1 block text-xs font-normal text-muted">
              Shows up as a planned contribution on the Budget page.
            </span>
          </label>
          <label
            aria-label="Spending against this goal reduces it"
            className="flex items-start gap-2 text-sm font-semibold"
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.spendingReduces}
              onChange={(e) => patch({ spendingReduces: e.target.checked })}
            />
            <span className="block">
              <span className="block">Spending against this goal reduces it</span>
              <span className="mt-1 block text-xs font-normal text-muted">
                Link a transaction to this goal from the ledger and it will be
                subtracted from the goal&apos;s progress.
              </span>
            </span>
          </label>
        </div>
      )}

      {draft.step === 4 && (
        <div className="mt-5 space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Name</dt>
              <dd>{draft.name || "Untitled"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Target</dt>
              <dd className="tabular-nums">{draft.targetAmount || "0"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Target date</dt>
              <dd>{draft.targetDate || "None"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Monthly</dt>
              <dd className="tabular-nums">
                {draft.monthlyContribution || "Not set"}
              </dd>
            </div>
          </dl>

          <fieldset className="border-t border-panel-border pt-4">
            <legend className="eyebrow mb-2">Fund it from an account</legend>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted">
                Connect an account to allocate a balance to this goal.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  <span className="mb-1 block text-xs text-muted">Account</span>
                  <select
                    value={draft.accountId}
                    onChange={(e) => patch({ accountId: e.target.value })}
                    className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
                  >
                    <option value="">No account</option>
                    {accounts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  <span className="mb-1 block text-xs text-muted">
                    How much of it
                  </span>
                  <select
                    value={draft.allocationMode}
                    onChange={(e) =>
                      patch({
                        allocationMode: e.target.value as Draft["allocationMode"],
                      })
                    }
                    className="min-h-11 w-full rounded-field border border-panel-border bg-background px-3"
                  >
                    <option value="none">Nothing yet</option>
                    <option value="fixed">A fixed amount</option>
                    <option value="entire">The entire balance</option>
                  </select>
                </label>
                {draft.allocationMode === "fixed" && (
                  <label className="text-sm font-semibold">
                    <span className="mb-1 block text-xs text-muted">Amount</span>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draft.allocationAmount}
                      onChange={(e) =>
                        patch({ allocationAmount: e.target.value })
                      }
                    />
                  </label>
                )}
                {draft.allocationMode === "entire" && selectedAccount && (
                  <p className="self-end text-xs text-muted">
                    Currently {selectedAccount.currentBalance ?? 0}.
                  </p>
                )}
              </div>
            )}
          </fieldset>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export default function GoalWizard({
  accounts,
  defaultGoalType = "save_up",
}: GoalWizardProps) {
  const router = useRouter();
  const supabase = createClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, goalType: defaultGoalType });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDialogKeyDown = useDialogFocus(dialogRef, open, cancel);

  /**
   * Restore on open rather than on mount. Reading sessionStorage during the
   * first render would not match the server's HTML, and restoring from an
   * effect would both trigger a cascading render and reopen the wizard
   * unprompted on an unrelated page visit. Opening it is the moment the user
   * has actually asked for their draft back.
   */
  function openWizard() {
    try {
      const stored = sessionStorage.getItem(DRAFT_KEY);
      if (stored) {
        setDraft({ ...EMPTY, ...(JSON.parse(stored) as Partial<Draft>) });
      }
    } catch {
      // A corrupt or unavailable store just means starting fresh.
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private-mode storage failures must not break the wizard.
    }
  }, [draft, open]);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function discard() {
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to clean up */
    }
    setDraft({ ...EMPTY, goalType: defaultGoalType });
    setError(null);
    setOpen(false);
  }

  function cancel() {
    if (isDirty(draft) && !window.confirm("Discard this goal draft?")) return;
    discard();
  }

  async function finish() {
    // Guards re-entrancy in place of a native `disabled`: the submit button
    // below stays enabled through the async call on purpose (see its own
    // comment) rather than disabling out from under its own focus.
    if (busy) return;
    setError(null);
    if (!isStepValid(draft)) {
      setError("Fill in the highlighted fields first.");
      return;
    }
    setBusy(true);
    try {
      // A retry after a failed account link reuses the already-created goal
      // instead of inserting a duplicate row from the same draft.
      let goalId = draft.createdGoalId;
      if (!goalId) {
        const { data: userData } = await supabase.auth.getUser();
        const targetAmount = Math.round(Number(draft.targetAmount) * 100) / 100;
        const { data: goal, error: insertError } = await supabase
          .from("goals")
          .insert({
            user_id: userData.user?.id,
            name: draft.name.trim(),
            target_amount: targetAmount,
            target_date: draft.targetDate || null,
            goal_type: draft.goalType,
            image_slug: draft.slug,
            monthly_contribution:
              draft.monthlyContribution === ""
                ? null
                : Math.round(Number(draft.monthlyContribution) * 100) / 100,
            spending_reduces: draft.spendingReduces,
            target_balance: draft.goalType === "save_up" ? targetAmount : 0,
          })
          .select("id")
          .single();
        if (insertError) {
          setError(insertError.message);
          return;
        }
        goalId = goal.id;
        patch({ createdGoalId: goal.id });
      }

      if (draft.allocationMode !== "none" && draft.accountId) {
        // The allocation goes through the API, not a direct insert: its
        // cross-goal rules need the database function's row lock.
        const response = await fetch("/api/goals/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goalId,
            accountId: draft.accountId,
            useEntireBalance: draft.allocationMode === "entire",
            allocatedAmount:
              draft.allocationMode === "fixed"
                ? Math.round(Number(draft.allocationAmount) * 100) / 100
                : undefined,
          }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          // The goal itself saved; say so rather than implying nothing happened.
          setError(
            `Goal created, but the account could not be linked: ${
              body?.error ?? "please try again from the goal card."
            }`,
          );
          router.refresh();
          return;
        }
      }

      discard();
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  // The trigger stays mounted while the wizard is open (it is covered by the
  // opaque full-screen dialog, and useDialogFocus traps Tab inside, so it is
  // neither visible nor reachable). Unmounting it instead would leave
  // useDialogFocus holding a detached node as the element to restore focus
  // to, and closing the wizard would drop focus to <body>.
  return (
    <>
      <Button type="button" onClick={openWizard}>
        Add goal
      </Button>
      {open && (
        <dialog
          open
          ref={dialogRef}
          aria-modal="true"
          aria-label="New goal"
          onKeyDown={handleDialogKeyDown}
          className="fixed inset-0 z-50 m-0 flex flex-col overflow-y-auto border-0 bg-background p-0"
        >
          <div className="border-b border-panel-border">
            <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={draft.step > 1 ? () => patch({ step: draft.step - 1 }) : cancel}
                disabled={busy || draft.createdGoalId !== null}
                aria-label={draft.step > 1 ? "Back" : "Cancel"}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
              >
                <ChevronLeft aria-hidden className="h-5 w-5" />
              </button>
              <ol className="flex gap-2" aria-label={`Step ${draft.step} of 4`}>
                {STEP_TITLES.map((title, index) => (
                  <li
                    key={title}
                    aria-current={index === draft.step - 1 ? "step" : undefined}
                    className={
                      index === draft.step - 1
                        ? "rounded-full bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent"
                        : "hidden rounded-full px-3 py-1.5 text-xs font-semibold text-muted sm:block"
                    }
                  >
                    {title}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={cancel}
                aria-label="Close"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>
            <div className="h-1 bg-panel-2">
              <div
                className="h-1 bg-accent transition-all duration-150"
                style={{ width: `${(draft.step / STEP_TITLES.length) * 100}%` }}
              />
            </div>
          </div>

          <GoalWizardStepContent
            accounts={accounts}
            draft={draft}
            error={error}
            patch={patch}
          />

          <div className="border-t border-panel-border px-4 py-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-2xl justify-center gap-3">
              {draft.step === 3 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => patch({ step: draft.step + 1 })}
                >
                  Skip
                </Button>
              )}
              {draft.step < 4 ? (
                <Button
                  type="button"
                  disabled={!isStepValid(draft)}
                  onClick={() => {
                    if (!isStepValid(draft)) return;
                    patch({ step: draft.step + 1 });
                  }}
                >
                  Continue
                </Button>
              ) : (
                // Deliberately not disabled while busy: this button is what
                // currently holds focus when finish() runs, and disabling
                // the focused control gets it blurred to <body> by the
                // browser — walking focus out of useDialogFocus's trap while
                // the dialog is still open (and back into the page behind
                // it, since the trigger button stays mounted there). finish()
                // itself now guards against a second concurrent submit.
                <Button type="button" aria-busy={busy || undefined} onClick={finish}>
                  {submitLabel(draft, busy)}
                </Button>
              )}
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
