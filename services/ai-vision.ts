import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Image as RNImage } from "react-native";
import {
  AIReceiptResponse,
  ImageProcessingResult,
  InvoiceType,
} from "../types/receipt";
import { reconcile, reconciliationComplaint } from "../utils/reconcile";

// OpenRouter API configuration (OpenAI-compatible chat completions)
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_ID = "google/gemini-2.5-flash";

// Image constraints
const MAX_BASE64_SIZE = 4 * 1024 * 1024; // 4MB
const TARGET_IMAGE_DIMENSION = 2048; // Target size for optimal OCR quality
const JPEG_QUALITY = 0.92; // Higher quality for better text recognition
const RETRY_BASE_DELAY_MS = 1000;
const MIN_ACCEPTABLE_CONFIDENCE = 0.45;

/**
 * Read on the second and later attempts. Flash is fast and cheap and handles
 * clean printed receipts; poor handwriting is where a stronger model separates
 * from it. Escalating rather than re-asking the same model matters — a model
 * that has just misread a digit at temperature 0 will misread it again.
 *
 * Costs 4.2x Flash on input and 4x on output ($1.25/$10 per M vs $0.30/$2.50,
 * OpenRouter, checked 2026-09-01), and only the minority of scans that fail the
 * first pass pay it — roughly a third of a US cent more on an escalated scan.
 * If that ever matters, the cheaper lever is raising the bar for escalating,
 * not going back to re-asking Flash.
 */
const FALLBACK_MODEL_ID = "google/gemini-2.5-pro";

/**
 * Get OpenRouter API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key not found. Please set EXPO_PUBLIC_OPENROUTER_API_KEY.",
    );
  }
  return apiKey;
}

/** Errors that retrying cannot fix (bad key, no credits) */
class NonRetryableError extends Error {}

/**
 * Receipt extraction prompt
 */
const EXTRACTION_PROMPT = `You are an expert multilingual receipt/invoice data extraction system with specialized support for Bengali/Bangla language and handwriting recognition. You excel at reading both printed and handwritten text in English and Bangla, even when handwriting is poor, messy, or difficult to read.

LANGUAGE SUPPORT - CRITICAL:
- This receipt may be in English, Bengali/Bangla, or a mix of both languages
- You MUST detect and read Bangla script (বাংলা) characters accurately
- DO NOT hallucinate or invent Bangla text - only extract what you can actually see in the image
- If Bangla text is unclear, extract what you can see, but do not make up words or characters

BANGLA ALPHABET REFERENCE - Use this to recognize characters:
- Bangla Vowels (স্বরবর্ণ): অ, আ, ই, ঈ, উ, ঊ, ঋ, এ, ঐ, ও, ঔ
- Bangla Consonants (ব্যঞ্জনবর্ণ): 
  - ক, খ, গ, ঘ, ঙ
  - চ, ছ, জ, ঝ, ঞ
  - ট, ঠ, ড, ঢ, ণ
  - ত, থ, দ, ধ, ন
  - প, ফ, ব, ভ, ম
  - য, র, ল, শ, ষ, স, হ
  - ড়, ঢ়, য়, ৎ
- Vowel Signs (কার): া, ি, ী, ু, ূ, ৃ, ে, ৈ, ো, ৌ
- Special Characters: ্ (হসন্ত), ঁ (চন্দ্রবিন্দু), ঃ (বিসর্গ), ং (অনুস্বার)
- Common Character Combinations:
  - ক্ষ (ক + ষ), জ্ঞ (জ + ঞ), ত্র (ত + র), শ্র (শ + র)
  - ষ্ঠ (ষ + ঠ), ষ্প (ষ + প), ষ্ম (ষ + ম), ন্ত (ন + ত), ন্দ (ন + দ)

Common Bangla Receipt Words (for context, but extract what you actually see):
- দোকান/দোকানী (shop/store), রেস্তোরাঁ (restaurant), বিল (bill)
- তারিখ (date), নাম (name), পরিমাণ (quantity), মূল্য (price)
- মোট (total), কর (tax), পরিশোধ (payment), নগদ (cash)
- দোকানের নাম (shop name), ঠিকানা (address), ফোন (phone)
- আইটেম (item), পণ্য (product), পরিমাণ (quantity), ইউনিট (unit)

IMPORTANT - Accuracy Rules:
- Read Bangla characters carefully - each character has distinct shapes
- Do NOT confuse similar-looking characters (e.g., ত vs থ, দ vs ধ, প vs ফ)
- Preserve exact Bangla spelling as written - do not correct or modify
- If a character is unclear, use context but do not invent characters
- For merchant_name and item names, preserve Bangla text exactly as written (don't translate to English)
- If you cannot read a Bangla word clearly, extract what you can see rather than guessing

HANDWRITING RECOGNITION - CRITICAL:
- This receipt may contain poor, messy, or difficult-to-read handwriting
- Apply advanced handwriting recognition techniques:
  - Look for character patterns even when strokes are incomplete or overlapping
  - Recognize common handwriting variations and sloppy writing styles
  - Use context clues (surrounding text, typical receipt formats) to interpret unclear characters
  - For numbers: recognize handwritten digits even if they're poorly formed, slanted, or partially obscured
  - For text: use linguistic context to fill in unclear Bangla or English characters
- Handle various handwriting issues:
  - Faint or light ink (barely visible strokes)
  - Overlapping or touching characters
  - Irregular spacing between words/characters
  - Slanted or rotated text
  - Incomplete characters (missing strokes)
  - Smudged or blurred writing
- If handwriting is extremely unclear, make your best educated guess based on context and typical receipt patterns
- Set confidence_score lower (0.3-0.6) for poor handwriting, but still extract what you can

IMAGE QUALITY HANDLING:
- Handle skewed, rotated, blurry, low-light, or low-resolution images
- Apply image enhancement techniques mentally to read text in poor conditions
- Look for text even when image quality is degraded
- If text is partially obscured or cut off, extract what's visible

CRITICAL: Bangla/Bengali Number Conversion
- The receipt may contain Bangla numerals (০, ১, ২, ৩, ৪, ৫, ৬, ৭, ৮, ৯) in both printed and handwritten form
- You MUST convert ALL Bangla numerals to their English equivalents:
  - ০ → 0, ১ → 1, ২ → 2, ৩ → 3, ৪ → 4
  - ৫ → 5, ৬ → 6, ৭ → 7, ৮ → 8, ৯ → 9
- ALL numeric fields (quantity, price, subtotal, tax, total) MUST be returned as numbers using English digits (0-9)
- Even if numbers appear in Bangla script (printed or handwritten), convert them to English numerals in the JSON response
- For example: "৫০০" or handwritten "৫০০" should be converted to 500, "১২৩৪" should be converted to 1234
- Handle handwritten Bangla numerals even when poorly written - use context and typical number patterns to interpret them

Return a JSON object with EXACTLY these fields:
{
  "merchant_name": "string or null - the store/business name",
  "receipt_date": "string or null - date in ISO format (YYYY-MM-DD)",
  "receipt_number": "string or null - receipt/invoice number if visible",
  "invoice_type": "one of: retail, restaurant, utility, service, unknown",
  "items": [
    {
      "name": "string - item description",
      "quantity": "number or null - MUST be English numerals",
      "price": "number - item total price, MUST be English numerals"
    }
  ],
  "subtotal": "number or null - MUST be English numerals",
  "tax": "number or null - MUST be English numerals", 
  "total": "number - the final total amount, MUST be English numerals",
  "currency": "string - currency code like BDT, USD, EUR",
  "payment_method": "string or null - Cash, Card, Mobile, etc.",
  "confidence_score": "number between 0 and 1 based on image quality and text clarity",
  "error_message": "string or null - only if image is not a valid receipt"
}

Rules:
- ACCURACY FIRST: Only extract text you can actually see in the image. DO NOT hallucinate, invent, or guess Bangla words. If text is unclear, extract partial text or use null rather than making up words.
- LANGUAGE: Read and extract text in both English and Bangla/Bengali. Use the Bangla alphabet reference above to recognize characters accurately. Preserve Bangla text in merchant_name and item names exactly as written (don't translate or modify).
- HANDWRITING: Apply advanced recognition for poor handwriting - use context, patterns, and educated guesses. Even messy handwriting should be extracted with appropriate confidence scores. However, if handwriting is too unclear to read, use null or partial text rather than guessing.
- If a field cannot be determined, use null (except required fields)
- total is required - estimate if not clearly visible, even from poor handwriting
- currency defaults to "BDT" if not detectable (common for Bangla receipts)
- confidence_score should reflect:
  - Image quality (blurry, low-light, skewed)
  - Text clarity (printed vs handwritten, handwriting quality)
  - Language complexity (mixed languages, unclear characters)
  - Range: 0.9-1.0 for clear printed text, 0.7-0.8 for clear handwriting, 0.4-0.6 for poor handwriting, 0.2-0.3 for very unclear text
- ALL numbers must be in English numerals (0-9), never Bangla numerals (০-৯), even if handwritten in Bangla
- For invoice_type:
  - "retail" for stores, supermarkets, shops (দোকান, সুপারমার্কেট)
  - "restaurant" for food establishments (রেস্তোরাঁ, হোটেল)
  - "utility" for electricity, water, gas, internet bills (বিদ্যুৎ, পানি, গ্যাস বিল)
  - "service" for services like repairs, maintenance
  - "unknown" if cannot determine or not a valid receipt
- If the image is NOT a receipt/invoice, set invoice_type to "unknown" and provide a clear error_message
- For poor handwriting: Extract best-effort values even if uncertain - it's better to have approximate data than null values

BEFORE YOU ANSWER - CHECK YOUR OWN ARITHMETIC:
A receipt is internally redundant, and that redundancy is how you catch your own
misreadings. Once you have read every amount, verify:
- the line item prices add up to the subtotal
- subtotal + tax equals the total
If they do not agree, you have almost certainly misread a digit. Go back to the
image and re-read the amounts, looking especially at digit pairs that are easy
to confuse in handwriting: 1/7, 0/6/9, 3/8, 5/6, and Bangla ১/৭, ০/৬, ৩/৮.
Do NOT adjust a number to force the arithmetic to work, and do NOT invent a
missing subtotal to make it balance - a receipt may genuinely not add up because
of an unlisted discount or service charge. Report the amounts you can actually
see; the check is there to make you look again, not to change the answer.

Return ONLY valid JSON, no markdown or explanation.`;

const HARD_HANDWRITING_FOLLOWUP_PROMPT = `${EXTRACTION_PROMPT}

SECOND PASS (HIGH PRIORITY):
- Re-read the image with extra focus on messy handwriting and faint Bangla numerals.
- Prioritize total, subtotal, tax, quantity, and line item prices.
- If text is unreadable, return null for that field instead of guessing.
- Never return Bangla digits in numeric fields.`;

const BANGLA_DIGIT_MAP: Record<string, string> = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

/**
 * Get image dimensions
 */
async function getImageDimensions(
  uri: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error),
    );
  });
}

/**
 * Process and resize image for API upload
 * Optimizes image for OCR by resizing, converting to JPEG, and compressing
 */
async function processImageForUpload(
  imageUri: string,
): Promise<ImageProcessingResult> {
  // Read the original file
  const fileInfo = await FileSystem.getInfoAsync(imageUri);

  if (!fileInfo.exists) {
    throw new Error("Image file not found");
  }

  // Get original dimensions
  const dimensions = await getImageDimensions(imageUri);
  const { width: originalWidth, height: originalHeight } = dimensions;
  const maxDimension = Math.max(originalWidth, originalHeight);

  // Calculate resize dimensions if needed
  // For OCR, we want to preserve as much detail as possible while staying within limits
  let targetWidth = originalWidth;
  let targetHeight = originalHeight;

  if (maxDimension > TARGET_IMAGE_DIMENSION) {
    const scale = TARGET_IMAGE_DIMENSION / maxDimension;
    targetWidth = Math.round(originalWidth * scale);
    targetHeight = Math.round(originalHeight * scale);
  }

  // Use manipulateAsync to resize and optimize the image
  // Note: manipulateAsync is deprecated but still functional
  // This ensures proper JPEG encoding and compression
  const manipulatedImage = await manipulateAsync(
    imageUri,
    [
      {
        resize: {
          width: targetWidth,
          height: targetHeight,
        },
      },
    ],
    {
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
      base64: true, // Get base64 directly from manipulator
    },
  );

  if (!manipulatedImage.base64) {
    throw new Error("Failed to process image");
  }

  // Check the actual base64 size
  // Base64 encoding increases size by ~33%, so we check the encoded size
  const base64Size = (manipulatedImage.base64.length * 3) / 4; // Approximate decoded size

  // If still too large, reduce quality and try again
  if (base64Size > MAX_BASE64_SIZE) {
    // Try with lower quality
    const compressedImage = await manipulateAsync(
      imageUri,
      [
        {
          resize: {
            width: targetWidth,
            height: targetHeight,
          },
        },
      ],
      {
        compress: 0.75, // Lower quality
        format: SaveFormat.JPEG,
        base64: true,
      },
    );

    if (!compressedImage.base64) {
      throw new Error("Failed to compress image");
    }

    const compressedSize = (compressedImage.base64.length * 3) / 4;

    if (compressedSize > MAX_BASE64_SIZE) {
      // Last resort: reduce dimensions further
      const finalScale = Math.sqrt(MAX_BASE64_SIZE / compressedSize) * 0.9; // 90% to be safe
      const finalWidth = Math.round(targetWidth * finalScale);
      const finalHeight = Math.round(targetHeight * finalScale);

      const finalImage = await manipulateAsync(
        imageUri,
        [
          {
            resize: {
              width: finalWidth,
              height: finalHeight,
            },
          },
        ],
        {
          compress: 0.75,
          format: SaveFormat.JPEG,
          base64: true,
        },
      );

      if (!finalImage.base64) {
        throw new Error("Failed to process image after compression");
      }

      return {
        uri: finalImage.uri,
        base64: finalImage.base64,
        width: finalWidth,
        height: finalHeight,
        fileSize: (finalImage.base64.length * 3) / 4,
      };
    }

    return {
      uri: compressedImage.uri,
      base64: compressedImage.base64,
      width: targetWidth,
      height: targetHeight,
      fileSize: compressedSize,
    };
  }

  return {
    uri: manipulatedImage.uri,
    base64: manipulatedImage.base64,
    width: targetWidth,
    height: targetHeight,
    fileSize: base64Size,
  };
}

/**
 * Parse receipt image using the OpenRouter vision API
 */
async function parseReceipt(
  imageUri: string,
  options?: {
    prompt?: string;
    processedImage?: ImageProcessingResult;
    model?: string;
  },
): Promise<AIReceiptResponse> {
  try {
    // Process image once and optionally reuse across retries
    const processedImage =
      options?.processedImage ?? (await processImageForUpload(imageUri));

    // Get API key
    const apiKey = getApiKey();

    // Prepare the request
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/jahidun-strativ/ai-invoice-extractor",
        "X-Title": "AI Receipt Scanner",
      },
      body: JSON.stringify({
        model: options?.model ?? MODEL_ID,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: options?.prompt ?? EXTRACTION_PROMPT,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${processedImage.base64}`,
                },
              },
            ],
          },
        ],
        temperature: 0.0, // Zero temperature to minimize hallucinations and ensure accuracy
        max_completion_tokens: 2048,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const detail = errorData.error?.message || response.statusText;
      if (response.status === 401) {
        throw new NonRetryableError(`Invalid OpenRouter API key: ${detail}`);
      }
      if (response.status === 402) {
        throw new NonRetryableError(`OpenRouter credits exhausted: ${detail}`);
      }
      throw new Error(`AI API error: ${response.status} - ${detail}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No response from AI API");
    }

    // Parse the JSON response
    const parsed = JSON.parse(content) as AIReceiptResponse;

    // Validate and normalize the response
    return normalizeResponse({
      ...parsed,
      raw_text: content,
    });
  } catch (error) {
    if (error instanceof NonRetryableError) {
      throw error; // let the retry loop short-circuit
    }
    // Return error response
    return {
      merchant_name: null,
      receipt_date: null,
      receipt_number: null,
      invoice_type: "unknown",
      items: [],
      subtotal: null,
      tax: null,
      total: null,
      currency: "BDT",
      payment_method: null,
      confidence_score: 0,
      error_message:
        error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

/**
 * Parse receipt with retry logic
 */
export async function parseReceiptWithRetry(
  imageUri: string,
  maxRetries: number = 3,
): Promise<AIReceiptResponse> {
  let lastError: Error | null = null;
  let bestResult: AIReceiptResponse | null = null;

  let processedImage: ImageProcessingResult;
  try {
    processedImage = await processImageForUpload(imageUri);
  } catch (error) {
    return {
      merchant_name: null,
      receipt_date: null,
      receipt_number: null,
      invoice_type: "unknown",
      items: [],
      subtotal: null,
      tax: null,
      total: null,
      currency: "BDT",
      payment_method: null,
      confidence_score: 0,
      error_message:
        error instanceof Error ? error.message : "Failed to process image",
    };
  }

  // Carries the specific arithmetic failure from one attempt into the next, so
  // the re-read is told which numbers did not add up rather than just being
  // asked to try harder.
  let complaint: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const basePrompt =
        attempt === 1 ? EXTRACTION_PROMPT : HARD_HANDWRITING_FOLLOWUP_PROMPT;
      const result = await parseReceipt(imageUri, {
        prompt: complaint ? `${basePrompt}\n\n${complaint}` : basePrompt,
        processedImage,
        // Escalate off Flash once it has already failed once on this image
        model: attempt === 1 ? MODEL_ID : FALLBACK_MODEL_ID,
      });

      if (
        !bestResult ||
        calculateExtractionScore(result) > calculateExtractionScore(bestResult)
      ) {
        bestResult = result;
      }

      complaint = reconciliationComplaint(result);

      if (shouldAcceptExtraction(result, attempt)) {
        return result;
      }

      lastError = new Error(
        result.error_message ||
          (complaint
            ? "Extracted amounts do not add up"
            : "Low-confidence extraction result"),
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (error instanceof NonRetryableError) {
        break; // retrying won't fix a bad key or exhausted credits
      }
    }

    // Wait before retry with exponential backoff
    if (attempt < maxRetries) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * RETRY_BASE_DELAY_MS),
      );
    }
  }

  if (bestResult) {
    return {
      ...bestResult,
      error_message:
        bestResult.error_message ||
        `Low confidence after ${maxRetries} attempts. Please review extracted fields.`,
    };
  }

  return {
    merchant_name: null,
    receipt_date: null,
    receipt_number: null,
    invoice_type: "unknown",
    items: [],
    subtotal: null,
    tax: null,
    total: null,
    currency: "BDT",
    payment_method: null,
    confidence_score: 0,
    error_message: `Failed after ${maxRetries} attempts: ${lastError?.message}`,
  };
}

/**
 * Normalize and validate the API response
 */
function normalizeResponse(response: AIReceiptResponse): AIReceiptResponse {
  // Normalize invoice type
  const validTypes: InvoiceType[] = [
    "retail",
    "restaurant",
    "utility",
    "service",
    "unknown",
  ];
  const invoiceType = validTypes.includes(response.invoice_type as InvoiceType)
    ? (response.invoice_type as InvoiceType)
    : "unknown";

  // Normalize items
  const items = Array.isArray(response.items)
    ? response.items.map((item) => ({
        name: String(item.name || "Unknown Item"),
        quantity: parseNumericValue(item.quantity),
        price: parseNumericValue(item.price) ?? 0,
      }))
    : [];

  // Normalize date to ISO format
  const receiptDate = normalizeDateToIso(response.receipt_date);

  // Normalize currency
  const currency = response.currency?.toUpperCase() || "BDT";

  // Normalize confidence score
  let confidenceScore = response.confidence_score;
  if (typeof confidenceScore !== "number" || confidenceScore < 0) {
    confidenceScore = 0;
  } else if (confidenceScore > 1) {
    confidenceScore = confidenceScore > 100 ? 1 : confidenceScore / 100;
  }

  const subtotal = parseNumericValue(response.subtotal);
  const tax = parseNumericValue(response.tax);
  const total = parseNumericValue(response.total);
  confidenceScore = calibrateConfidenceScore({
    confidenceScore,
    hasMerchant: Boolean(response.merchant_name),
    hasItems: items.length > 0,
    hasTotal: total !== null,
    // `checked &&` deliberately: a receipt with nothing to verify must not earn
    // the consistency bonus, which is what the old subtotal===null branch did.
    hasMathConsistency: ((r) => r.checked && r.ok)(
      reconcile({ items, subtotal, tax, total }),
    ),
    hasError: Boolean(response.error_message),
  });

  return {
    merchant_name: response.merchant_name || null,
    receipt_date: receiptDate,
    receipt_number: response.receipt_number || null,
    invoice_type: invoiceType,
    items,
    subtotal,
    tax,
    total,
    currency,
    payment_method: response.payment_method || null,
    confidence_score: confidenceScore,
    error_message: response.error_message || null,
    raw_text: response.raw_text || null,
  };
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedDigits = convertBanglaDigits(value).trim();
  if (!normalizedDigits) {
    return null;
  }

  const cleaned = normalizedDigits
    .replace(/[, ]+/g, "")
    .replace(/[^\d.-]/g, "");

  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function convertBanglaDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => BANGLA_DIGIT_MAP[digit] ?? digit);
}

function normalizeDateToIso(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = convertBanglaDigits(value).trim();
  const ymdMatch = normalized.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (ymdMatch) {
    return formatDate(ymdMatch[1], ymdMatch[2], ymdMatch[3]);
  }

  const dmyMatch = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmyMatch) {
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return formatDate(year, dmyMatch[2], dmyMatch[1]);
  }

  const parsed = new Date(normalized);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

function formatDate(year: string, month: string, day: string): string | null {
  const yyyy = Number(year);
  const mm = Number(month);
  const dd = Number(day);

  if (
    !Number.isInteger(yyyy) ||
    !Number.isInteger(mm) ||
    !Number.isInteger(dd) ||
    yyyy < 1900 ||
    yyyy > 2100 ||
    mm < 1 ||
    mm > 12 ||
    dd < 1 ||
    dd > 31
  ) {
    return null;
  }

  const iso = `${yyyy.toString().padStart(4, "0")}-${mm
    .toString()
    .padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !isNaN(parsed.getTime()) ? iso : null;
}

function calibrateConfidenceScore(input: {
  confidenceScore: number;
  hasMerchant: boolean;
  hasItems: boolean;
  hasTotal: boolean;
  hasMathConsistency: boolean;
  hasError: boolean;
}): number {
  let score = input.confidenceScore;

  if (input.hasMerchant) score += 0.03;
  if (input.hasItems) score += 0.07;
  if (input.hasTotal) score += 0.1;
  if (input.hasMathConsistency) score += 0.05;
  if (!input.hasTotal) score -= 0.25;
  if (input.hasError) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

function shouldAcceptExtraction(
  response: AIReceiptResponse,
  attempt: number,
): boolean {
  if (response.error_message && response.total === null) {
    return false;
  }

  if (response.total === null) {
    return false;
  }

  // Amounts that do not add up mean a digit was misread — confidence says
  // nothing about this, because the model is equally sure of a wrong digit.
  // Only the first pass is rejected for it: plenty of real receipts genuinely
  // do not balance (an unlisted discount, a service charge), and burning every
  // attempt and every escalated call on those would cost money to arrive at
  // the same answer. The second reading stands, and the UI flags it for review.
  if (attempt === 1 && !reconcile(response).ok) {
    return false;
  }

  if (response.confidence_score >= MIN_ACCEPTABLE_CONFIDENCE) {
    return true;
  }

  const hasCoreData =
    Boolean(response.merchant_name) || response.items.length > 0;
  return hasCoreData && response.confidence_score >= 0.3;
}

function calculateExtractionScore(response: AIReceiptResponse): number {
  let score = response.confidence_score * 100;
  if (response.total !== null) score += 60;
  if (response.items.length > 0) score += 20;
  if (response.merchant_name) score += 10;
  if (response.receipt_date) score += 5;
  if (response.error_message) score -= 40;
  // Weighted above merchant and date but below having a total: between two
  // readings of the same image, the one whose amounts add up is the one whose
  // digits were read correctly, and amounts are what the sheet is paid against.
  const math = reconcile(response);
  if (math.checked && math.ok) score += 30;
  return score;
}

/**
 * Validate if an image is suitable for processing
 */
export async function validateImage(
  imageUri: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(imageUri);

    if (!fileInfo.exists) {
      return { valid: false, error: "Image file not found" };
    }

    // Check file size (rough estimate) - size is available on existant files
    const size =
      (fileInfo as FileSystem.FileInfo & { size?: number }).size || 0;
    if (size > 20 * 1024 * 1024) {
      return { valid: false, error: "Image file is too large (max 20MB)" };
    }

    // Check dimensions
    const dimensions = await getImageDimensions(imageUri);
    const totalPixels = dimensions.width * dimensions.height;

    if (totalPixels > 33177600) {
      return {
        valid: false,
        error: "Image resolution too high (max 33 megapixels)",
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error:
        error instanceof Error ? error.message : "Failed to validate image",
    };
  }
}
