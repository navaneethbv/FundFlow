import React from 'react';

interface Tab {
  id: string;
  label: string;
}

const tabs: Tab[] = [
  { id: 'cash', label: 'Cash Flow' },
  { id: 'spending', label: 'Spending' },
  { id: 'income', label: 'Income' },
];

export default function ReportTabs({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex border-b border-gray-200 mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 focus:outline-none ${selected === tab.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-600 hover:text-gray-800'}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
