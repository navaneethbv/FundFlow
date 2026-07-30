import { describe, it, expect } from 'vitest';
import { getMockHoldings, type Holding } from '@/lib/investments';

describe('investments lib', () => {
  it('returns a non-empty list of holdings', () => {
    const holdings = getMockHoldings();
    expect(holdings.length).toBeGreaterThan(0);
  });

  it('each holding has required fields', () => {
    const holdings = getMockHoldings();
    for (const h of holdings) {
      expect(h.id).toBeTruthy();
      expect(h.name).toBeTruthy();
      expect(h.ticker).toBeTruthy();
      expect(h.quantity).toBeGreaterThan(0);
      expect(h.price).toBeGreaterThan(0);
      expect(h.value).toBe(h.quantity * h.price);
    }
  });
});
