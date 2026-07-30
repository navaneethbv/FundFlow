'use client';

import React, { useState } from 'react';
import Panel from '@/components/ui/Panel';

interface FlagDef {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

const defaultFlags: FlagDef[] = [
  { key: 'accountsPage', label: 'Accounts Page', description: 'Show the linked-accounts overview.', enabled: true },
  { key: 'cashFlowPage', label: 'Cash Flow Page', description: 'Show the cash-flow analysis page.', enabled: true },
  { key: 'budgetPage', label: 'Budget Page', description: 'Enable the budget planning page.', enabled: false },
  { key: 'investmentsPage', label: 'Investments Page', description: 'Show the investments portfolio.', enabled: false },
  { key: 'forecastingPage', label: 'Forecasting Page', description: 'Enable Monte-Carlo forecasting.', enabled: false },
  { key: 'advicePage', label: 'Advice Page', description: 'Show personalised financial advice.', enabled: false },
];

export default function FeatureFlags() {
  const [flags, setFlags] = useState(defaultFlags);

  function toggle(key: string) {
    setFlags((prev) =>
      prev.map((f) => (f.key === key ? { ...f, enabled: !f.enabled } : f)),
    );
    // In production, persist via /api/settings/feature-flags
  }

  return (
    <Panel title="Feature Flags" eyebrow="Experimental">
      <ul className="space-y-3">
        {flags.map((flag) => (
          <li key={flag.key} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
            <div>
              <p className="font-medium text-sm">{flag.label}</p>
              <p className="text-xs text-gray-500">{flag.description}</p>
            </div>
            <button
              onClick={() => toggle(flag.key)}
              className={`relative inline-flex h-6 w-11 rounded-full transition ${flag.enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${flag.enabled ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`}
              />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
