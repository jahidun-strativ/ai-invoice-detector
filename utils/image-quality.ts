/**
 * On-device pre-flight check that a captured photo plausibly shows a receipt,
 * WITHOUT calling the AI. Receipts are bright (paper), sharp, and edge-dense
 * (rows of printed text); blurry shots, dark pockets, walls, and floors fail
 * one of those tests. Runs on a ~160px thumbnail in a few milliseconds.
 *
 * This is a heuristic gate, not a classifier — callers must offer a
 * "process anyway" override for false rejections.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

// ponytail: hand-tuned thresholds on a 160px grayscale thumbnail; recalibrate
// against a labelled set of real office receipts if rejections feel wrong.
const THUMB_WIDTH = 160;
const MIN_MEAN_BRIGHTNESS = 35; // below: too dark to read anything
const MIN_SHARPNESS = 25; // Laplacian variance; below: blurry / out of focus
const MIN_BRIGHT_RATIO = 0.15; // fraction of paper-bright pixels (>150)
const MIN_EDGE_RATIO = 0.02; // fraction of strong-gradient pixels (text)

export interface ImageQualityResult {
  ok: boolean;
  /** Human-readable reason when ok === false */
  reason: string | null;
  metrics: {
    meanBrightness: number;
    sharpness: number;
    brightRatio: number;
    edgeRatio: number;
  };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function assessReceiptImage(
  imageUri: string,
): Promise<ImageQualityResult> {
  // Tiny grayscale-ish thumbnail: enough signal, trivial compute
  const thumb = await manipulateAsync(
    imageUri,
    [{ resize: { width: THUMB_WIDTH } }],
    { compress: 0.9, format: SaveFormat.JPEG, base64: true },
  );
  if (!thumb.base64) {
    // Can't analyze — don't block the user on our own failure
    return {
      ok: true,
      reason: null,
      metrics: { meanBrightness: 0, sharpness: 0, brightRatio: 0, edgeRatio: 0 },
    };
  }

  const { data, width, height } = jpeg.decode(base64ToBytes(thumb.base64), {
    useTArray: true,
  });

  // Grayscale plane
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  let sum = 0;
  let bright = 0;
  for (let p = 0; p < gray.length; p++) {
    sum += gray[p];
    if (gray[p] > 150) bright++;
  }
  const meanBrightness = sum / gray.length;
  const brightRatio = bright / gray.length;

  // Laplacian response: sharpness (variance) + edge density (strong responses)
  let lapSum = 0;
  let lapSqSum = 0;
  let edges = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const lap =
        4 * gray[p] - gray[p - 1] - gray[p + 1] - gray[p - width] - gray[p + width];
      lapSum += lap;
      lapSqSum += lap * lap;
      if (Math.abs(lap) > 40) edges++;
      n++;
    }
  }
  const lapMean = lapSum / n;
  const sharpness = lapSqSum / n - lapMean * lapMean;
  const edgeRatio = edges / n;

  const metrics = { meanBrightness, sharpness, brightRatio, edgeRatio };

  if (meanBrightness < MIN_MEAN_BRIGHTNESS) {
    return { ok: false, reason: 'The photo is too dark to read.', metrics };
  }
  if (sharpness < MIN_SHARPNESS) {
    return {
      ok: false,
      reason: 'The photo looks blurry — hold steady and try again.',
      metrics,
    };
  }
  if (brightRatio < MIN_BRIGHT_RATIO || edgeRatio < MIN_EDGE_RATIO) {
    return {
      ok: false,
      reason: "This doesn't look like a receipt or invoice.",
      metrics,
    };
  }
  return { ok: true, reason: null, metrics };
}
