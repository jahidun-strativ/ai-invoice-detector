/**
 * The save-to-device path. The office needs the sheet as a real file in a
 * folder they can open, not only as something the share sheet passes on, so
 * this checks the SAF round-trip: right folder, right name, right bytes — and
 * that backing out of the picker writes nothing.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { saveFileToDevice } from '../export';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  readAsStringAsync: jest.fn(async () => 'BASE64BYTES'),
  writeAsStringAsync: jest.fn(async () => undefined),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(async () => 'content://tree/downloads/doc/sheet.xlsx'),
  },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

const saf = FileSystem.StorageAccessFramework as jest.Mocked<
  typeof FileSystem.StorageAccessFramework
>;

const SHEET = 'file:///docs/exports/Strativ_Bill_Approval_August_2026.xlsx';

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
});

it('writes the export into the folder the user picked', async () => {
  saf.requestDirectoryPermissionsAsync.mockResolvedValue({
    granted: true,
    directoryUri: 'content://tree/downloads',
  } as any);

  const saved = await saveFileToDevice(SHEET);

  expect(saved).toBe('Strativ_Bill_Approval_August_2026.xlsx');
  // Name without the extension — createFileAsync appends it from the MIME type
  expect(saf.createFileAsync).toHaveBeenCalledWith(
    'content://tree/downloads',
    'Strativ_Bill_Approval_August_2026',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  // Base64 both ways, or the XLSX arrives corrupt
  expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(SHEET, {
    encoding: 'base64',
  });
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
    'content://tree/downloads/doc/sheet.xlsx',
    'BASE64BYTES',
    { encoding: 'base64' },
  );
});

it('writes nothing when the user backs out of the folder picker', async () => {
  saf.requestDirectoryPermissionsAsync.mockResolvedValue({ granted: false } as any);

  expect(await saveFileToDevice(SHEET)).toBeNull();
  expect(saf.createFileAsync).not.toHaveBeenCalled();
  expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
});

it('falls back to the share sheet off Android, where there is no SAF', async () => {
  Platform.OS = 'ios';

  expect(await saveFileToDevice(SHEET)).toBe(
    'Strativ_Bill_Approval_August_2026.xlsx',
  );
  expect(saf.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
  expect(require('expo-sharing').shareAsync).toHaveBeenCalledWith(
    SHEET,
    expect.objectContaining({
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
});

it('picks the JSON MIME type from the extension', async () => {
  saf.requestDirectoryPermissionsAsync.mockResolvedValue({
    granted: true,
    directoryUri: 'content://tree/downloads',
  } as any);

  await saveFileToDevice('file:///docs/exports/receipts_export_2026.json');

  expect(saf.createFileAsync).toHaveBeenCalledWith(
    'content://tree/downloads',
    'receipts_export_2026',
    'application/json',
  );
});
