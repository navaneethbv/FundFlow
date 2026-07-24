/**
 * Demo mode (7.4): a deterministic fake dataset so the app can be
 * screenshotted or demoed without exposing a single real number. Rows hang
 * off a fake plaid_items row with status 'disconnected', which every sync
 * path already skips (crons select status='active'), and ids carry a
 * `demo-` prefix so clearing is one cascade delete.
 */

const MERCHANTS: Array<{ name: string; category: string; min: number; max: number }> = [
  { name: "Corner Grocer", category: "FOOD_AND_DRINK", min: 30, max: 140 },
  { name: "Blue Bottle Cafe", category: "FOOD_AND_DRINK", min: 4, max: 14 },
  { name: "City Transit", category: "TRANSPORTATION", min: 2.75, max: 30 },
  { name: "Metro Power & Light", category: "RENT_AND_UTILITIES", min: 80, max: 160 },
  { name: "Streamly", category: "ENTERTAINMENT", min: 15.99, max: 15.99 },
  { name: "Fitness Collective", category: "PERSONAL_CARE", min: 45, max: 45 },
  { name: "Novel Idea Books", category: "GENERAL_MERCHANDISE", min: 12, max: 60 },
  { name: "Meadow Pharmacy", category: "MEDICAL", min: 8, max: 75 },
  { name: "Alpine Airlines", category: "TRAVEL", min: 180, max: 420 },
];

/** Small deterministic PRNG (mulberry32) so demos are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoDataset {
  item: { plaid_item_id: string; institution_name: string; status: string };
  accounts: Array<{
    plaid_account_id: string;
    name: string;
    type: string;
    subtype: string;
    mask: string;
    current_balance: number;
  }>;
  transactions: Array<{
    plaid_transaction_id: string;
    accountIndex: number;
    date: string;
    amount: number;
    name: string;
    merchant_name: string;
    pfc_primary: string;
    pending: boolean;
  }>;
}

export function buildDemoDataset(input: {
  userId: string;
  today: string;
  months?: number;
}): DemoDataset {
  const months = input.months ?? 6;
  // Seed from the user id so re-loading produces the same dataset.
  let seed = 0;
  for (const char of input.userId) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const random = mulberry32(seed || 42);

  const transactions: DemoDataset["transactions"] = [];
  const [year, month] = input.today.split("-").map(Number);

  for (let monthOffset = 0; monthOffset < months; monthOffset++) {
    const total = year! * 12 + (month! - 1) - monthOffset;
    const ym = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;

    // Paycheck twice a month into checking (negative = money in).
    for (const payDay of ["05", "20"]) {
      transactions.push({
        plaid_transaction_id: `demo-pay-${ym}-${payDay}`,
        accountIndex: 0,
        date: `${ym}-${payDay}`,
        amount: -2450,
        name: "Acme Payroll",
        merchant_name: "Acme Payroll",
        pfc_primary: "INCOME",
        pending: false,
      });
    }

    // Rent from checking.
    transactions.push({
      plaid_transaction_id: `demo-rent-${ym}`,
      accountIndex: 0,
      date: `${ym}-01`,
      amount: 1650,
      name: "Maple Street Apartments",
      merchant_name: "Maple Street Apartments",
      pfc_primary: "RENT_AND_UTILITIES",
      pending: false,
    });

    // 18-30 card purchases spread across the month.
    const purchaseCount = 18 + Math.floor(random() * 13);
    for (let i = 0; i < purchaseCount; i++) {
      const merchant = MERCHANTS[Math.floor(random() * MERCHANTS.length)]!;
      const day = String(1 + Math.floor(random() * 28)).padStart(2, "0");
      const amount =
        Math.round((merchant.min + random() * (merchant.max - merchant.min)) * 100) / 100;
      transactions.push({
        plaid_transaction_id: `demo-txn-${ym}-${i}`,
        accountIndex: 1,
        date: `${ym}-${day}`,
        amount,
        name: merchant.name,
        merchant_name: merchant.name,
        pfc_primary: merchant.category,
        pending: false,
      });
    }
  }

  return {
    item: {
      plaid_item_id: `demo-item-${input.userId}`,
      institution_name: "Demo Bank (sample data)",
      status: "disconnected",
    },
    accounts: [
      {
        plaid_account_id: `demo-checking-${input.userId}`,
        name: "Demo Checking",
        type: "depository",
        subtype: "checking",
        mask: "0001",
        current_balance: 4820.55,
      },
      {
        plaid_account_id: `demo-card-${input.userId}`,
        name: "Demo Rewards Card",
        type: "credit",
        subtype: "credit card",
        mask: "0002",
        current_balance: 1240.3,
      },
    ],
    transactions,
  };
}
