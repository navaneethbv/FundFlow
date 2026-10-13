"use client";

import Button from "@/components/ui/Button";

export default function PrintReportButton() {
  return <Button type="button" variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>;
}
