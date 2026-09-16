/**
 * Line-item arithmetic.
 *
 * `price` stays the line total throughout the app — the AI prompt asks for
 * "item total price" and reconcile.ts sums it against the subtotal — so the
 * unit price is the derived half, not the stored one. Editing works the other
 * way round: staff type a quantity and a unit price, because that is what a
 * handwritten receipt actually prints, and the line total follows.
 */

import { LineItem } from '@/types/receipt';

/** Money rounding: 3 x 0.1 is 0.30000000000000004 without it */
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Whether the receipt actually broke this line into a count and a rate.
 *
 * Plenty of real lines never do — a rickshaw fare, a repair charge, an
 * internet bill — and plenty of shop receipts print a quantity only when it is
 * more than one. The sheet leaves Qty and Unit Price blank in that case rather
 * than printing a quantity of 1 nobody wrote: it is a document four people
 * sign, so "not stated" must not read as a stated 1.
 */
export function hasBreakdown(item: Pick<LineItem, 'quantity'>): boolean {
  return typeof item.quantity === 'number' && item.quantity > 0;
}

/**
 * Quantity as a number to multiply by. A line with no stated quantity means
 * one of the thing — never zero, which would wipe the line total out. Use this
 * for arithmetic only; use hasBreakdown to decide whether to print it.
 */
export function quantityOf(item: Pick<LineItem, 'quantity'>): number {
  return hasBreakdown(item) ? (item.quantity as number) : 1;
}

/**
 * Per-unit price. Prefers one that was actually read or typed; otherwise
 * divides the line total, which is what every receipt scanned before this
 * existed has to fall back on.
 */
export function unitPriceOf(item: LineItem): number {
  if (typeof item.unit_price === 'number') return item.unit_price;
  return round2(item.price / quantityOf(item));
}

/** The line total the sheet prints and reconcile.ts sums */
export function lineTotal(quantity: number | null, unitPrice: number): number {
  return round2(quantityOf({ quantity }) * unitPrice);
}
