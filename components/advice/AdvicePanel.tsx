'use client';

import React from 'react';
import type { AdviceItem } from '@/lib/advice';

const severityStyles: Record<string, string> = {
  tip: 'border-emerald-400 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-400 bg-amber-50 text-amber-800',
  critical: 'border-red-400 bg-red-50 text-red-800',
};

const severityIcons: Record<string, string> = {
  tip: '💡',
  warning: '⚠️',
  critical: '🚨',
};

export default function AdvicePanel({ items }: { items: AdviceItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center text-emerald-700">
        <p className="text-lg font-semibold">All good! 🎉</p>
        <p className="mt-1 text-sm">No urgent advice right now. Keep up the great work.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-lg border-l-4 p-4 shadow-sm ${severityStyles[item.severity] ?? ''}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">{severityIcons[item.severity]}</span>
            <h3 className="font-semibold">{item.title}</h3>
            <span className="ml-auto rounded-full bg-white/60 px-2 py-0.5 text-xs font-medium">
              {item.category}
            </span>
          </div>
          <p className="mt-1 text-sm">{item.body}</p>
        </div>
      ))}
    </div>
  );
}
