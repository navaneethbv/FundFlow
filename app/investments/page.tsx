import React, { useEffect, useState } from 'react';
import InvestmentsTable from '@/components/investments/InvestmentsTable';
import { Holding } from '@/lib/investments';

export default function InvestmentsPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function fetchHoldings() {
      setLoading(true);
      const res = await fetch('/api/investments');
      const json = await res.json();
      setHoldings(json.holdings ?? []);
      setLoading(false);
    }
    fetchHoldings();
  }, []);

  return (
    <section className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Investments</h1>
      {loading ? (
        <p className="text-gray-600">Loading…</p>
      ) : (
        <InvestmentsTable holdings={holdings} />
      )}
    </section>
  );
}
