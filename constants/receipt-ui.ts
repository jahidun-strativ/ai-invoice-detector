/**
 * Shared invoice-type display metadata (icons, labels, colors).
 * Single source of truth — do not redeclare these maps in screens.
 */

import { ThemeColors } from '@/constants/theme';
import { InvoiceType } from '@/types/receipt';
import { IconSymbolName } from '@/components/ui/icon-symbol';

export const INVOICE_TYPE_ICONS: Record<InvoiceType, IconSymbolName> = {
  retail: 'cart.fill',
  restaurant: 'fork.knife',
  utility: 'bolt.fill',
  service: 'wrench.and.screwdriver.fill',
  unknown: 'doc.questionmark.fill',
};

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  retail: 'Retail',
  restaurant: 'Restaurant',
  utility: 'Utility',
  service: 'Service',
  unknown: 'Unknown',
};

// Category colors follow the Strativ data-viz palette; brand orange is
// reserved for the accent, so categories never use it.
const INVOICE_TYPE_COLOR_KEYS: Record<InvoiceType, keyof ThemeColors> = {
  retail: 'accentTeal',
  restaurant: 'accentYellow',
  utility: 'info',
  service: 'accentViolet',
  unknown: 'neutral',
};

export function getInvoiceTypeColor(type: InvoiceType, colors: ThemeColors): string {
  return colors[INVOICE_TYPE_COLOR_KEYS[type]];
}
