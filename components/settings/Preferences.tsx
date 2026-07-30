'use client';

import React, { useState } from 'react';
import Panel from '@/components/ui/Panel';

interface Pref {
  key: string;
  label: string;
  value: string;
  options: string[];
}

const defaultPrefs: Pref[] = [
  { key: 'currency', label: 'Currency', value: 'USD', options: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'] },
  { key: 'dateFormat', label: 'Date Format', value: 'MM/DD/YYYY', options: ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] },
  { key: 'theme', label: 'Theme', value: 'system', options: ['light', 'dark', 'system'] },
  { key: 'locale', label: 'Number Locale', value: 'en-US', options: ['en-US', 'en-GB', 'de-DE', 'fr-FR'] },
];

export default function Preferences() {
  const [prefs, setPrefs] = useState(defaultPrefs);

  function update(key: string, value: string) {
    setPrefs((prev) =>
      prev.map((p) => (p.key === key ? { ...p, value } : p)),
    );
    // In production, persist via /api/settings/preferences
  }

  return (
    <Panel title="Preferences" eyebrow="Display & formats">
      <div className="grid gap-4 sm:grid-cols-2">
        {prefs.map((pref) => (
          <div key={pref.key} className="flex flex-col">
            <label className="text-sm font-medium text-gray-700 mb-1">{pref.label}</label>
            <select
              value={pref.value}
              onChange={(e) => update(pref.key, e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {pref.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </Panel>
  );
}
