/** Mock investment holdings data and helpers */
export interface Holding {
  id: string;
  name: string;
  ticker: string;
  quantity: number; // shares
  price: number; // price per share in cents
  value: number; // total value in cents (quantity * price)
}

/** Return a static list of mock holdings for demo purposes */
export function getMockHoldings(): Holding[] {
  const holdings: Holding[] = [
    { id: '1', name: 'Apple Inc.', ticker: 'AAPL', quantity: 10, price: 17500, value: 175000 },
    { id: '2', name: 'Tesla, Inc.', ticker: 'TSLA', quantity: 5, price: 25000, value: 125000 },
    { id: '3', name: 'Amazon.com, Inc.', ticker: 'AMZN', quantity: 2, price: 34000, value: 68000 },
  ];
  return holdings;
}
