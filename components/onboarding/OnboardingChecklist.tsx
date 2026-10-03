"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/client";
import {
  completedOnboardingCount,
  mergeOnboardingPrefs,
  onboardingTourIndex,
  ONBOARDING_STEP_KEYS,
  type OnboardingPrefs,
} from "@/lib/onboarding";
import type { OnboardingPageData } from "@/lib/onboarding-data";

export default function OnboardingChecklist({
  initial,
}: Readonly<{ initial: OnboardingPageData }>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const [prefs, setPrefs] = useState<OnboardingPrefs>(initial.prefs);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(() => onboardingTourIndex(initial.prefs, initial.status));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completed = completedOnboardingCount(initial.status);
  const current = initial.steps[tourStep] ?? initial.steps[0]!;

  useEffect(() => {
    if (!tourOpen) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTourOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tourOpen]);

  async function persist(patch: OnboardingPrefs) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: profile, error: readError } = await supabase
        .from("profiles")
        .select("dashboard_prefs")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (readError) throw readError;
      const next = mergeOnboardingPrefs(profile?.dashboard_prefs, patch);
      const { error } = await supabase.from("profiles").update({ dashboard_prefs: next }).eq("id", auth.user.id);
      if (error) throw error;
      setPrefs((currentPrefs) => ({ ...currentPrefs, ...patch }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save setup progress.");
    } finally {
      setSaving(false);
    }
  }

  function openTour() {
    setTourStep(onboardingTourIndex(prefs, initial.status));
    setTourOpen(true);
    void persist({ dismissed: false });
  }

  function closeTour() {
    setTourOpen(false);
    void persist({ tourStep });
  }

  function dismiss() {
    setTourOpen(false);
    void persist({ dismissed: true, tourStep });
  }

  if (prefs.dismissed && !tourOpen) {
    return (
      <Panel title="Setup checklist" eyebrow="Make FundFlow yours" padding="md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{completed} of {initial.steps.length} steps complete. You can resume anytime.</p>
          <Button variant="secondary" onClick={openTour} disabled={saving}>Resume setup tour</Button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title="Start with a five-step setup"
        eyebrow="First run"
        action={<Button variant="ghost" size="sm" onClick={dismiss} disabled={saving}>Dismiss</Button>}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{completed} of {initial.steps.length} steps complete. Resume where you left off.</p>
            <div className="mt-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={initial.steps.length} aria-valuenow={completed}>
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${(completed / initial.steps.length) * 100}%` }} />
            </div>
          </div>
          <Button onClick={openTour} disabled={saving}>{completed === initial.steps.length ? "Review setup tour" : "Start guided tour"}</Button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <ol className="mt-5 grid gap-2 md:grid-cols-2" aria-label="Setup checklist">
          {initial.steps.map((step, index) => (
            <li key={step.key} className="flex items-start gap-3 rounded-field bg-panel-2 p-3">
              <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.complete ? "bg-success text-success-foreground" : "border border-panel-border text-muted"}`}>
                {step.complete ? "✓" : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{step.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{step.available ? step.description : "This step is waiting for the payday settings release."}</span>
              </span>
              {!step.complete && step.available && <ButtonLink href={step.href} variant="ghost" size="sm">Open</ButtonLink>}
            </li>
          ))}
        </ol>
      </Panel>
      {tourOpen && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-tour-title" tabIndex={-1} className="rounded-card border border-accent/40 bg-panel p-5 shadow-pop focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Guided setup · Step {tourStep + 1} of {initial.steps.length}</p>
              <h2 id="onboarding-tour-title" className="card-title">{current.label}</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={closeTour}>Close</Button>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">{current.available ? current.description : "Payday settings are not enabled in this release. You can return here when the feature is available."}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {current.available && !current.complete && <ButtonLink href={current.href} onClick={closeTour}>Open {current.label.toLowerCase()}</ButtonLink>}
            <Button variant="secondary" onClick={() => setTourStep((step) => Math.max(0, step - 1))} disabled={tourStep === 0}>Previous</Button>
            <Button onClick={() => {
              const next = Math.min(ONBOARDING_STEP_KEYS.length - 1, tourStep + 1);
              setTourStep(next);
              void persist({ tourStep: next });
            }} disabled={tourStep === ONBOARDING_STEP_KEYS.length - 1}>Next</Button>
          </div>
        </div>
      )}
    </>
  );
}
