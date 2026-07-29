"use client";

import { useState } from "react";
import { Sparkles } from "@/components/ui/icons";

export default function SeedBudgetButton() {
  const [loading, setLoading] = useState(false);

  const handleAutoSeed = async () => {
    setLoading(true);
    try {
      // Auto seed action or modal trigger
      window.location.reload();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleAutoSeed}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-field bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span>Auto-budget from history</span>
    </button>
  );
}
