"use client";
import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TAX_BUCKETS, type BasisAnnotation, type TaxBucket } from "@/lib/investment-provenance";
import type { MortgageInput, PortfolioInput } from "@/lib/portfolio-input";
import type { LiabilityOption } from "@/lib/portfolio-data";
import Button from "@/components/ui/Button";
import { fieldClasses } from "@/components/ui/Input";

export interface AnnotationFormProps {
  initial: PortfolioInput;
  name: string;
  quantity?: number | null;
  liabilities?: LiabilityOption[];
  today?: string;
}
const fieldClass = fieldClasses;

function BasisFields({ prefix, initial }: Readonly<{ prefix: string; initial: BasisAnnotation | null }>) {
  return <><label className="block" htmlFor={`${prefix}-amount`}>Total cost basis (USD)<input className={fieldClass} id={`${prefix}-amount`} name="amount" type="number" required min="0" max="999999999999.99" step="0.01" defaultValue={initial?.amount ?? ""} /></label>
    <label className="block" htmlFor={`${prefix}-source`}>Basis source<select className={fieldClass} id={`${prefix}-source`} name="source" defaultValue={initial?.source ?? "manual"}><option value="manual">Manual entry</option><option value="imported">Imported statement</option><option value="estimated">Estimate</option></select></label></>;
}
function MortgageFields({ prefix, initial, liabilities, today }: Readonly<{ prefix: string; initial: MortgageInput | null; liabilities: LiabilityOption[]; today?: string }>) {
  return <><label className="block" htmlFor={`${prefix}-liability`}>Existing liability<select className={fieldClass} id={`${prefix}-liability`} name="liabilityId" required defaultValue={initial?.liabilityId ?? ""}><option value="" disabled>Choose a liability</option>{liabilities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label className="block" htmlFor={`${prefix}-date`}>First payment date<input className={fieldClass} id={`${prefix}-date`} name="startDate" type="date" required defaultValue={initial?.terms.startDate ?? today} /></label>
    {([{ name: "principal", label: "Principal before first payment (USD)", min: "0.01", max: "999999999999.99", step: "0.01" }, { name: "annualRate", label: "Fixed annual interest (%)", min: "0", max: "100", step: "0.001" }, { name: "paymentAmount", label: "Monthly principal and interest payment (USD)", min: "0.01", max: "999999999999.99", step: "0.01" }, { name: "termMonths", label: "Maximum payments (months)", min: "1", max: "1200", step: "1" }] as const).map((field) => <label key={field.name} className="block" htmlFor={`${prefix}-${field.name}`}>{field.label}<input className={fieldClass} id={`${prefix}-${field.name}`} name={field.name} type="number" required min={field.min} max={field.max} step={field.step} defaultValue={initial?.terms[field.name] ?? ""} /></label>)}</>;
}
function formData(kind: PortfolioInput["kind"], form: FormData, quantity: number | null | undefined, liabilities: LiabilityOption[]): PortfolioInput["data"] {
  if (kind === "basis") return { amount: Number(form.get("amount")), quantity: quantity!, source: String(form.get("source")) as BasisAnnotation["source"] };
  if (kind === "tax") return { bucket: String(form.get("bucket")) as TaxBucket };
  const liability = liabilities.find((a) => a.id === form.get("liabilityId"));
  if (!liability) throw new Error("Choose an existing liability.");
  return { liabilityId: liability.id, liabilitySource: liability.source, terms: { principal: Number(form.get("principal")), annualRate: Number(form.get("annualRate")), paymentAmount: Number(form.get("paymentAmount")), startDate: String(form.get("startDate")), termMonths: Number(form.get("termMonths")) } };
}

export default function PortfolioAnnotationForm({ initial, name, quantity, liabilities = [], today }: Readonly<AnnotationFormProps>) {
  const prefix = useId();
  const router = useRouter();
  const [version, setVersion] = useState(initial.version);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(data: PortfolioInput["data"]) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/portfolio-annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...initial, version, data }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save configuration.");
      setVersion(result.version); setMessage(data === null ? "Override removed." : "Configuration saved."); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save configuration."); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await save(formData(initial.kind, new FormData(event.currentTarget), quantity, liabilities)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Check the form."); }
  }
  const unavailable = (initial.kind === "basis" && quantity == null) || (initial.kind === "mortgage" && liabilities.length === 0);
  return <form onSubmit={submit} className="space-y-3" aria-label={`${name} configuration`}>
    <fieldset disabled={busy || unavailable} className="min-w-0 space-y-3"><legend className="font-medium">{name}</legend>
      {initial.kind === "basis" && <BasisFields prefix={prefix} initial={initial.data as BasisAnnotation | null} />}
      {initial.kind === "mortgage" && <MortgageFields prefix={prefix} initial={initial.data as MortgageInput | null} liabilities={liabilities} today={today} />}
      {initial.kind === "tax" && <label className="block" htmlFor={`${prefix}-bucket`}>Tax treatment<select className={fieldClass} id={`${prefix}-bucket`} name="bucket" defaultValue={(initial.data as { bucket: TaxBucket } | null)?.bucket ?? "unknown"}>{Object.entries(TAX_BUCKETS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <Button type="submit" loading={busy}>Save configuration</Button>
    </fieldset>
    {version > 0 && <button disabled={busy} className="text-sm underline" type="button" onClick={async () => { try { await save(null); } catch { setError("Could not remove override."); } }}>Remove override</button>}
    {unavailable && <p className="text-sm text-muted">{initial.kind === "basis" ? "Basis needs a reported holding quantity." : "Add an owned USD loan or manual liability account first."}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </form>;
}
