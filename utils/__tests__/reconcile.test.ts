/**
 * The arithmetic check that catches misread digits on handwritten receipts.
 * The two failure modes it is tuned between are both tested here: a warning
 * that never fires (a misread digit reaching the signed sheet) and one that
 * fires constantly (staff stop reading warnings).
 */

import { reconcile, reconciliationComplaint } from '../reconcile';

const item = (price: number | null) => ({ price });

describe('reconcile', () => {
  it('accepts a receipt that adds up', () => {
    const result = reconcile({
      items: [item(60), item(40)],
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result).toEqual({ ok: true, checked: true, issues: [] });
  });

  it('catches a misread digit in the total', () => {
    // 115 read as 715 — the classic 1/7 handwriting confusion
    const result = reconcile({
      items: [item(60), item(40)],
      subtotal: 100,
      tax: 15,
      total: 715,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('115');
    expect(result.issues[0]).toContain('715');
  });

  it('catches a misread line item, where the items stop matching the subtotal', () => {
    const result = reconcile({
      items: [item(60), item(90)], // second item was 40
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatch(/Line items add up to 150.*subtotal says 100/);
  });

  it('checks items against the total when the receipt has no subtotal', () => {
    // Handwritten receipts routinely omit the subtotal line
    expect(reconcile({ items: [item(60), item(40)], subtotal: null, tax: null, total: 100 }).ok).toBe(
      true,
    );
    expect(reconcile({ items: [item(60), item(40)], subtotal: null, tax: null, total: 700 }).ok).toBe(
      false,
    );
  });

  describe('does not fire on receipts that are fine', () => {
    it('tolerates rounding to the whole unit', () => {
      expect(reconcile({ items: [], subtotal: 99.5, tax: 0, total: 100 }).ok).toBe(true);
    });

    it('tolerates proportionally larger rounding on a large bill', () => {
      // 1% of 10,000 — cash receipts round harder at this size
      expect(reconcile({ items: [], subtotal: 9950, tax: 0, total: 10000 }).ok).toBe(true);
    });

    it('treats a missing tax line as zero rather than a discrepancy', () => {
      expect(reconcile({ items: [], subtotal: 100, tax: null, total: 100 }).ok).toBe(true);
    });

    it('skips items whose price could not be read', () => {
      expect(
        reconcile({ items: [item(60), item(null)], subtotal: 60, tax: null, total: 60 }).ok,
      ).toBe(true);
    });
  });

  describe('checked flag', () => {
    it('is false when only a total was extracted, so nothing could be verified', () => {
      const result = reconcile({ items: [], subtotal: null, tax: null, total: 500 });
      // ok, but only because there was no check to fail — callers must not
      // read this as confirmation
      expect(result).toEqual({ ok: true, checked: false, issues: [] });
    });

    it('is false when there is no total to compare anything against', () => {
      expect(reconcile({ items: [item(10)], subtotal: 10, tax: null, total: null }).checked).toBe(
        false,
      );
    });

    it('is true as soon as one comparison is possible', () => {
      expect(reconcile({ items: [item(100)], subtotal: null, tax: null, total: 100 }).checked).toBe(
        true,
      );
    });
  });
});

describe('reconciliationComplaint', () => {
  it('is null when the numbers agree, so nothing is appended to the re-read', () => {
    expect(
      reconciliationComplaint({ items: [item(100)], subtotal: 100, tax: 0, total: 100 }),
    ).toBeNull();
  });

  it('names the actual discrepancy and warns against forcing the sum', () => {
    const complaint = reconciliationComplaint({
      items: [item(60), item(40)],
      subtotal: 100,
      tax: 15,
      total: 715,
    });

    expect(complaint).toContain('ARITHMETIC CHECK FAILED');
    expect(complaint).toContain('715');
    // The model must not "fix" a genuinely unbalanced receipt by inventing a figure
    expect(complaint).toMatch(/does not add up|rather than/);
  });
});
