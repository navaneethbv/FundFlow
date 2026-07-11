export interface CardStyle {
  bgGradient: string;
  textColor: string;
  borderColor: string;
  displayName: string;
  network: "visa" | "mastercard" | "amex" | "apple" | "discover" | "generic";
}

/**
 * Detect the design tokens for a card based on its name and Plaid metadata.
 */
export function detectCardDesign(
  name: string | null | undefined,
  officialName: string | null | undefined,
  type: string | null | undefined,
  subtype: string | null | undefined,
): CardStyle {
  const normName = `${name ?? ""} ${officialName ?? ""}`.toLowerCase();

  // 1. Identify Card Network
  let network: CardStyle["network"] = "generic";
  if (normName.includes("visa")) {
    network = "visa";
  } else if (normName.includes("mastercard") || normName.includes("mc")) {
    network = "mastercard";
  } else if (
    normName.includes("amex") ||
    normName.includes("american express") ||
    normName.includes("blue cash")
  ) {
    network = "amex";
  } else if (normName.includes("apple")) {
    network = "apple";
  } else if (normName.includes("discover")) {
    network = "discover";
  }

  // 2. Checking / Debit Accounts (Depository)
  if (type === "depository" || subtype === "checking" || subtype === "savings") {
    return {
      bgGradient: "from-emerald-800 via-teal-900 to-emerald-950",
      textColor: "text-emerald-50",
      borderColor: "border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.3)]",
      displayName: name || "Checking Account",
      network,
    };
  }

  // 3. Premium Card Products
  if (normName.includes("gold") && !normName.includes("goldman")) {
    return {
      bgGradient: "from-[#f4e4b5] via-[#dfb957] to-[#9c7b20]",
      textColor: "text-stone-900 font-medium",
      borderColor: "border-[#dfb957] shadow-[0_0_12px_rgba(223,185,87,0.4)]",
      displayName: "Amex Gold",
      network: "amex",
    };
  }

  if (normName.includes("platinum")) {
    return {
      bgGradient: "from-[#eaeaea] via-[#cbcbcb] to-[#9e9e9e]",
      textColor: "text-stone-800 font-medium",
      borderColor: "border-white/80 shadow-[0_0_12px_rgba(255,255,255,0.3)]",
      displayName: "Amex Platinum",
      network: "amex",
    };
  }

  if (normName.includes("reserve")) {
    return {
      bgGradient: "from-[#1a1c23] via-[#242731] to-[#0d0e12]",
      textColor: "text-slate-100",
      borderColor: "border-slate-400 shadow-[0_0_12px_rgba(148,163,184,0.3)]",
      displayName: "Sapphire Reserve",
      network,
    };
  }

  if (normName.includes("preferred") || normName.includes("sapphire")) {
    return {
      bgGradient: "from-[#081a3e] via-[#10306b] to-[#1c53b2]",
      textColor: "text-sky-100",
      borderColor: "border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.3)]",
      displayName: "Sapphire Preferred",
      network,
    };
  }

  if (normName.includes("freedom")) {
    return {
      bgGradient: "from-[#033f9e] via-[#0575e6] to-[#00f2fe]",
      textColor: "text-white",
      borderColor: "border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.3)]",
      displayName: "Chase Freedom",
      network,
    };
  }

  if (normName.includes("apple")) {
    return {
      bgGradient: "from-white via-[#f5f5f7] to-[#e3e3e6]",
      textColor: "text-black",
      borderColor: "border-slate-350 shadow-[0_0_12px_rgba(0,0,0,0.15)]",
      displayName: "Apple Card",
      network: "apple",
    };
  }

  if (normName.includes("venture")) {
    return {
      bgGradient: "from-[#0f1f38] via-[#24416d] to-[#456e9c]",
      textColor: "text-sky-50",
      borderColor: "border-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.3)]",
      displayName: "Capital One Venture",
      network,
    };
  }

  // 4. Fallback Generic Credit Cards based on Network
  if (network === "visa") {
    return {
      bgGradient: "from-blue-900 via-indigo-950 to-slate-950",
      textColor: "text-blue-50",
      borderColor: "border-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.3)]",
      displayName: name || "Visa Credit",
      network,
    };
  }

  if (network === "mastercard") {
    return {
      bgGradient: "from-[#201d1d] via-[#a13c1a] to-[#3a1b10]",
      textColor: "text-orange-50",
      borderColor: "border-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.3)]",
      displayName: name || "Mastercard Credit",
      network,
    };
  }

  return {
    bgGradient: "from-slate-800 via-slate-900 to-zinc-950",
    textColor: "text-slate-200",
    borderColor: "border-slate-400 shadow-[0_0_12px_rgba(148,163,184,0.3)]",
    displayName: name || "Credit Card",
    network,
  };
}
