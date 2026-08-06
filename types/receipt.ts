/**
 * Receipt Types
 * TypeScript interfaces for structured receipt data
 */

export type InvoiceType = 'retail' | 'restaurant' | 'utility' | 'service' | 'unknown';

export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'online' | 'other' | null;

export interface LineItem {
  name: string;
  quantity: number | null;
  price: number;
  unit_price?: number | null;
}

export interface Receipt {
  id: string;
  merchant_name: string | null;
  receipt_date: string | null;
  receipt_number: string | null;
  invoice_type: InvoiceType;
  items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number;
  currency: string;
  payment_method: string | null;
  confidence_score: number;
  image_uri: string;
  raw_text: string | null;
  error_message: string | null;
  created_at: string;
}

/**
 * Response from the AI vision API after parsing receipt
 */
export interface AIReceiptResponse {
  merchant_name: string | null;
  receipt_date: string | null;
  receipt_number: string | null;
  invoice_type: InvoiceType;
  items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string;
  payment_method: string | null;
  confidence_score: number;
  error_message?: string | null;
  raw_text?: string | null;
}

/**
 * Receipt creation input (before ID and timestamp assignment)
 */
export interface ReceiptInput {
  merchant_name: string | null;
  receipt_date: string | null;
  receipt_number: string | null;
  invoice_type: InvoiceType;
  items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number;
  currency: string;
  payment_method: string | null;
  confidence_score: number;
  image_uri: string;
  raw_text: string | null;
  error_message: string | null;
}

/**
 * Receipt filter options for history screen
 */
export interface ReceiptFilter {
  invoice_type?: InvoiceType;
  start_date?: string;
  end_date?: string;
  merchant_name?: string;
  min_total?: number;
  max_total?: number;
}

/**
 * Receipt statistics for dashboard
 */
export interface ReceiptStats {
  total_count: number;
  total_amount: number;
  this_month_count: number;
  this_month_amount: number;
  needs_review_count: number;
  by_type: Record<InvoiceType, number>;
  by_currency: Record<string, number>;
}

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Processing state for capture screen
 */
export type ProcessingState = 'idle' | 'capturing' | 'processing' | 'success' | 'error';

/**
 * Image processing result
 */
export interface ImageProcessingResult {
  uri: string;
  base64: string;
  width: number;
  height: number;
  fileSize: number;
}
