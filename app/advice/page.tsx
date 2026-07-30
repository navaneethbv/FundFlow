'use client';

import React, { useEffect, useState } from 'react';
import AdvicePanel from '@/components/advice/AdvicePanel';
import type { AdviceItem, AdviceInput } from '@/lib/advice';

export default function AdvicePage() {
  const [items, setItems] = useState<AdviceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAdvice() {
      setLoading(true);
      // Demo input — in production this would come from the user's real data
      const input: AdviceInput = {
        monthlyIncome: 6000,
        monthlySpend: 4500,
        savingsRate: 0.12,
        emergencyFundMonths: 2.1,
        debtToIncomeRatio: 0.28,
        goalCount: 1,
        hasInvestments: false,
      };
      try {
        const res = await fetch('/api/advice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const json = await res.json();
        setItems(json.advice ?? []);
      } catch {
        // silently degrade
      } finally {
        setLoading(false);
      }
    }
    fetchAdvice();
  }, []);

  return (
    <section className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Financial Advice</h1>
      <p className="mb-4 text-gray-600">
        Personalised recommendations based on your goals, cash-flow, and spending.
      </p>
      {loading ? <p className="text-gray-500">Generating advice…</p> : <AdvicePanel items={items} />}
    </section>
  );
}
