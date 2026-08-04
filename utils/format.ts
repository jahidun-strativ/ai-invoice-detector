/**
 * Shared display formatters for currency and dates.
 */

export function formatCurrency(amount: number, currency: string = 'BDT'): string {
  return `${currency} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(isoDate: string | null): string {
  if (!isoDate) return 'Unknown date';
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
