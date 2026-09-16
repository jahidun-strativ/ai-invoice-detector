/**
 * The edit modal types a quantity and a unit price; everything else in the app
 * reads the line total. These two have to stay in agreement, or a corrected
 * unit price leaves a stale total next to it on the signed sheet.
 */

import { hasBreakdown, lineTotal, quantityOf, unitPriceOf } from '../line-item';

const item = (over: Partial<Parameters<typeof unitPriceOf>[0]> = {}) => ({
  name: 'Cement',
  quantity: 1,
  price: 100,
  ...over,
});

describe('hasBreakdown', () => {
  it('is true when the receipt stated a count', () => {
    expect(hasBreakdown({ quantity: 5 })).toBe(true);
    // A receipt that printed "1" did state it, and the sheet should show it
    expect(hasBreakdown({ quantity: 1 })).toBe(true);
  });

  // The sheet leaves Qty and Unit Price blank for these rather than asserting 1
  it('is false for a line the receipt never broke down', () => {
    expect(hasBreakdown({ quantity: null })).toBe(false);
    expect(hasBreakdown({ quantity: 0 })).toBe(false);
  });
});

describe('quantityOf', () => {
  it('takes the quantity the receipt stated', () => {
    expect(quantityOf({ quantity: 5 })).toBe(5);
  });

  it('treats a missing quantity as one, not zero', () => {
    expect(quantityOf({ quantity: null })).toBe(1);
  });

  // A zero would wipe the line total out, and a receipt never means "none of it"
  it('treats zero and negatives as one', () => {
    expect(quantityOf({ quantity: 0 })).toBe(1);
    expect(quantityOf({ quantity: -2 })).toBe(1);
  });
});

describe('unitPriceOf', () => {
  it('prefers a unit price that was read or typed', () => {
    expect(unitPriceOf(item({ quantity: 5, price: 1250, unit_price: 250 }))).toBe(250);
  });

  it('divides the line total when there is none — every older receipt', () => {
    expect(unitPriceOf(item({ quantity: 4, price: 320 }))).toBe(80);
  });

  it('falls back to the whole line total when no quantity was read', () => {
    expect(unitPriceOf(item({ quantity: null, price: 500 }))).toBe(500);
  });

  it('rounds to the paisa instead of trailing float noise', () => {
    expect(unitPriceOf(item({ quantity: 3, price: 100 }))).toBe(33.33);
  });
});

describe('lineTotal', () => {
  it('multiplies quantity by unit price', () => {
    expect(lineTotal(5, 250)).toBe(1250);
  });

  it('is the unit price itself when no quantity was given', () => {
    expect(lineTotal(null, 500)).toBe(500);
  });

  it('does not produce 0.30000000000000004', () => {
    expect(lineTotal(3, 0.1)).toBe(0.3);
  });

  // Round-trips: what the sheet prints must come back as what was typed
  it('agrees with unitPriceOf on a stored unit price', () => {
    const price = lineTotal(7, 12.5);
    expect(unitPriceOf(item({ quantity: 7, price, unit_price: 12.5 }))).toBe(12.5);
    expect(price).toBe(87.5);
  });
});
