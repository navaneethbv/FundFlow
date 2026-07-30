'use client';

import React, { useState } from 'react';
import ForecastChart from '@/components/forecasting/ForecastChart';
import type { CashFlowForecast, ForecastInput } from '@/lib/planning';

export default function ForecastingPage() {
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runForecast() {
    setLoading(true);
    setError(null);

    const input: ForecastInput = {
      startingBalance: 5000,
      asOf: new Date().toISOString().slice(0, 10),
      horizonDays: 90,
      lowBalanceThreshold: 500,
      items: [
        { name: 'Salary', amount: 3500, itemType: 'income', frequency: 'biweekly', nextDate: new Date().toISOString().slice(0, 10) },
        { name: 'Rent', amount: 1500, itemType: 'expense', frequency: 'monthly', nextDate: new Date().toISOString().slice(0, 10) },
        { name: 'Groceries', amount: 400, itemType: 'expense', frequency: 'monthly', nextDate: new Date().toISOString().slice(0, 10) },
        { name: 'Subscriptions', amount: 80, itemType: 'expense', frequency: 'monthly', nextDate: new Date().toISOString().slice(0, 10) },
      ],
    };

    try {
      const res = await fetch('/api/forecasting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setForecast(json.forecast);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Cash-Flow Forecasting</h1>
      <p className="mb-4 text-gray-600">
        Run a Monte-Carlo simulation to project your cash-flow over the next 90 days.
      </p>
      <button
        onClick={runForecast}
        disabled={loading}
        className="mb-6 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white shadow hover:bg-indigo-700 transition disabled:opacity-50"
      >
        {loading ? 'Running…' : 'Run Forecast'}
      </button>
      {error && <p className="text-red-600 mb-4">{error}</p>}
      {forecast && <ForecastChart forecast={forecast} />}
    </section>
  );
}
