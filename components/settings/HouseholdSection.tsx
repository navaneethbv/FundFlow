"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface HouseholdRow {
  id: string;
  name: string;
}

export default function HouseholdSection({ initialHouseholds }: { initialHouseholds: HouseholdRow[] }) {
  const supabase = createClient();
  const [households, setHouseholds] = useState(initialHouseholds);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function createHousehold() {
    setStatus(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus("Enter a household name.");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setStatus("Sign in again to create a household.");
      return;
    }
    const { data, error } = await supabase
      .from("households")
      .insert({ owner_user_id: userId, name: trimmed })
      .select("id, name")
      .single();
    if (error) {
      setStatus(error.message);
      return;
    }
    setHouseholds((current) => [...current, data as HouseholdRow]);
    setName("");
    setStatus("Household created.");
  }

  return (
    <Panel title="Household mode" eyebrow="Shared planning">
      <div className="space-y-2 text-sm">
        {households.length === 0 ? (
          <p className="text-muted">Create a household when you are ready to share budgets, goals, and reports.</p>
        ) : (
          households.map((household) => (
            <div key={household.id} className="rounded-field bg-panel-2 p-3 font-semibold">
              {household.name}
            </div>
          ))
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Household name" />
        <Button type="button" onClick={createHousehold}>
          Create
        </Button>
      </div>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
