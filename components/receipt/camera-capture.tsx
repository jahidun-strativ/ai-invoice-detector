/**
 * Camera Capture Component
 * Camera view with capture and gallery picker functionality
 */

import { useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface CameraCaptureProps {
  onCapture: (imageUri: string) => void;
  onCancel?: () => void;
  isProcessing?: boolean;
}

export function CameraCapture({
  onCapture,
  onCancel,
  isProcessing = false,
}: CameraCaptureProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // Handle permission request
  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.permissionContainer}>
          <IconSymbol name="camera.fill" size={64} color={colors.icon} />
          <Text style={[styles.permissionText, { color: colors.text }]}>
            Camera access is needed to capture receipts
          </Text>
          <TouchableOpacity
            style={[styles.permissionButton, { backgroundColor: colors.tint }]}
            onPress={requestPermission}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={pickImage}>
            <Text style={[styles.secondaryButtonText, { color: colors.tint }]}>
              Or pick from gallery
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Take photo with camera
  async function takePicture() {
    if (!cameraRef.current || isCapturing) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });

      if (photo?.uri) {
        setCapturedImage(photo.uri);
      }
    } catch {
      Alert.alert('Error', 'Failed to capture image. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }

  // Pick image from gallery
  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setCapturedImage(result.assets[0].uri);
    }
  }

  // Toggle camera facing
  function toggleCameraFacing() {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  }

  // Reset captured image
  function retake() {
    setCapturedImage(null);
  }

  // Confirm and process captured image
  function confirmCapture() {
    if (capturedImage) {
      onCapture(capturedImage);
    }
  }

  // If we have a captured image, show preview
  if (capturedImage) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.previewContainer}>
          <Image
            source={{ uri: capturedImage }}
            style={styles.previewImage}
            contentFit="contain"
          />
        </View>

        <View style={[styles.previewActions, { paddingBottom: insets.bottom + 16 }]}>
          {isProcessing ? (
            <View style={styles.processingContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
              <Text style={[styles.processingText, { color: colors.text }]}>
                Extracting data with AI…
              </Text>
              <Text style={[styles.processingHint, { color: colors.textSecondary }]}>
                Reading merchant, items, and totals
              </Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionButton, styles.retakeButton]}
                onPress={retake}
              >
                <IconSymbol name="arrow.counterclockwise" size={24} color="#fff" />
                <Text style={styles.actionButtonText}>Retake</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.tint }]}
                onPress={confirmCapture}
              >
                <IconSymbol name="checkmark" size={24} color="#fff" />
                <Text style={styles.actionButtonText}>Process Receipt</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  // Camera view
  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
      >
        {/* Top controls */}
        <View style={[styles.topControls, { paddingTop: insets.top + 12 }]}>
          {onCancel && (
            <TouchableOpacity style={styles.topButton} onPress={onCancel}>
              <IconSymbol name="xmark" size={28} color="#fff" />
            </TouchableOpacity>
          )}
          <View style={styles.spacer} />
          <TouchableOpacity style={styles.topButton} onPress={toggleCameraFacing}>
            <IconSymbol name="arrow.triangle.2.circlepath" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Scan guide overlay */}
        <View style={styles.scanGuide}>
          <View style={styles.scanCorner} />
          <View style={[styles.scanCorner, styles.scanCornerTopRight]} />
          <View style={[styles.scanCorner, styles.scanCornerBottomLeft]} />
          <View style={[styles.scanCorner, styles.scanCornerBottomRight]} />
          <Text style={styles.scanText}>
            Position the receipt within the frame
          </Text>
        </View>

        {/* Bottom controls */}
        <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 24 }]}>
          <TouchableOpacity style={styles.galleryButton} onPress={pickImage}>
            <IconSymbol name="photo.on.rectangle" size={32} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.captureButton,
              isCapturing && styles.captureButtonDisabled,
            ]}
            onPress={takePicture}
            disabled={isCapturing}
          >
            {isCapturing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <View style={styles.captureButtonInner} />
            )}
          </TouchableOpacity>

          <View style={styles.galleryButton} />
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  permissionText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  permissionButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    padding: 16,
  },
  secondaryButtonText: {
    fontSize: 16,
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    flex: 1,
  },
  scanGuide: {
    flex: 1,
    margin: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanCorner: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 40,
    height: 40,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#fff',
  },
  scanCornerTopRight: {
    left: undefined,
    right: 0,
    borderLeftWidth: 0,
    borderRightWidth: 3,
  },
  scanCornerBottomLeft: {
    top: undefined,
    bottom: 0,
    borderTopWidth: 0,
    borderBottomWidth: 3,
  },
  scanCornerBottomRight: {
    top: undefined,
    left: undefined,
    right: 0,
    bottom: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  scanText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  galleryButton: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  captureButtonDisabled: {
    opacity: 0.6,
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  previewImage: {
    flex: 1,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  retakeButton: {
    backgroundColor: '#666',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  processingContainer: {
    alignItems: 'center',
    gap: 12,
    padding: 20,
  },
  processingText: {
    fontSize: 17,
    fontWeight: '600',
  },
  processingHint: {
    fontSize: 14,
  },
});
