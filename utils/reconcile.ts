/**
 * Arithmetic reconciliation.
 *
 * A receipt is internally redundant: the line items sum to the subtotal, and
 * the subtotal plus tax makes the total. When the model misreads a handwritten
 * digit — 1 for 7, 0 for 6 — that redundancy breaks, and the arithmetic says so
 * without anyone having to recognise the handwriting. This is the only check in
 * the app that can catch a wrong amount using nothing but the numbers.
 *
 * It is **advisory, never a rejection**. Real receipts fail to add up for
 * honest reasons: an unlisted discount, a service charge, VAT quoted on part of
 * the bill, or line items the writer never wrote down. So a mismatch means
 * "a human should look at this", not "this is wrong".
 *
 * Derived on demand rather than stored: an edit that fixes the numbers must
 * clear the warning, and a stored flag would go stale the moment someone
 * corrected a total.
 */

/** The shape both `AIReceiptResponse` and `Receipt` satisfy */
export interface Reconcilable {
  items: { price: number | null }[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

export interface ReconcileResult {
  /** False only when a check actually ran and failed */
  ok: boolean;
  /**
   * Whether any check could run at all. A handwritten receipt with only a
   * total has nothing to verify, which is not the same as verified-correct —
   * callers rewarding consistency must require `checked && ok`, or they credit
   * a receipt for the absence of evidence.
   */
  checked: boolean;
  /** Human-readable, one per failed check — safe to show in the UI */
  issues: string[];
}

/**
 * How far apart two amounts may sit before it counts as a discrepancy.
 *
 * Tuned against the two failure modes rather than for mathematical purity:
 * too tight and every rounded-off taka raises a warning until staff stop
 * reading warnings; too loose and a misread digit slips through. A misread
 * digit moves an amount by at least one whole unit and usually far more, so
 * one unit — or 1% on a large bill, where cash receipts round harder — sits
 * between the two.
 *
 * ponytail: hand-tuned like the thresholds in utils/image-quality.ts. If real
 * receipts turn out to warn too often, widen this before adding smarter rules.
 */
const ABSOLUTE_TOLERANCE = 1;
const RELATIVE_TOLERANCE = 0.01;

function tolerance(amount: number): number {
  return Math.max(ABSOLUTE_TOLERANCE, Math.abs(amount) * RELATIVE_TOLERANCE);
}

function agrees(a: number, b: number): boolean {
  return Math.abs(a - b) <= tolerance(Math.max(Math.abs(a), Math.abs(b)));
}

/** Money for a message: two decimals, but no trailing ".00" noise */
function amount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function sumItems(items: { price: number | null }[]): number | null {
  const prices = items.map((item) => item.price).filter((p): p is number => typeof p === 'number');
  return prices.length ? prices.reduce((sum, p) => sum + p, 0) : null;
}

/**
 * Check a receipt's own arithmetic. Every check is skipped when the numbers it
 * needs are missing — an absent subtotal is normal on a handwritten receipt and
 * is not a discrepancy.
 */
export function reconcile(receipt: Reconcilable): ReconcileResult {
  const issues: string[] = [];
  const { subtotal, tax, total } = receipt;
  const itemsTotal = sumItems(receipt.items ?? []);

  // Nothing to check against: the total is the one figure everything else is
  // compared to, and without it there is no arithmetic to do.
  if (typeof total !== 'number') {
    return { ok: true, checked: false, issues };
  }

  // Something to compare the total against — otherwise only a bare total was
  // extracted and no check is possible.
  const checked = typeof subtotal === 'number' || itemsTotal !== null;

  if (itemsTotal !== null && typeof subtotal === 'number' && !agrees(itemsTotal, subtotal)) {
    issues.push(
      `Line items add up to ${amount(itemsTotal)}, but the subtotal says ${amount(subtotal)}.`,
    );
  }

  if (typeof subtotal === 'number') {
    const expected = subtotal + (tax ?? 0);
    if (!agrees(expected, total)) {
      issues.push(
        tax
          ? `Subtotal ${amount(subtotal)} plus tax ${amount(tax)} makes ${amount(expected)}, but the total says ${amount(total)}.`
          : `Subtotal ${amount(subtotal)} does not match the total ${amount(total)}.`,
      );
    }
  } else if (itemsTotal !== null) {
    // No subtotal on the receipt — compare the items straight to the total
    const expected = itemsTotal + (tax ?? 0);
    if (!agrees(expected, total)) {
      issues.push(
        `Line items${tax ? ' plus tax' : ''} add up to ${amount(expected)}, but the total says ${amount(total)}.`,
      );
    }
  }

  return { ok: issues.length === 0, checked, issues };
}

/**
 * The discrepancy phrased for the model, to be appended to a re-read prompt.
 * Null when the numbers reconcile and there is nothing to say.
 */
export function reconciliationComplaint(receipt: Reconcilable): string | null {
  const { issues } = reconcile(receipt);
  if (issues.length === 0) return null;

  return [
    'ARITHMETIC CHECK FAILED on your previous reading of this image:',
    ...issues.map((issue) => `- ${issue}`),
    '',
    'At least one digit was misread. Re-read every amount on the image,',
    'digit by digit, and pay particular attention to digits that are easy to',
    'confuse in handwriting (1/7, 0/6/9, 3/8, 5/6). Return the amounts you can',
    'actually see — if the receipt genuinely does not add up (an unlisted',
    'discount or service charge), keep the amounts as written rather than',
    'adjusting a figure to force the arithmetic to work.',
  ].join('\n');
}
