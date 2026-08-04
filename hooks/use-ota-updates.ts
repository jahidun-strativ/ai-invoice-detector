/**
 * OTA Updates Hook
 * Handles checking for and applying over-the-air updates
 */

import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';

export interface UpdateCheckResult {
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  isChecking: boolean;
  error: Error | null;
  manifest: Updates.Manifest | null;
}

/**
 * Hook to check for and apply OTA updates
 * 
 * @param options Configuration options
 * @param options.checkOnMount Whether to check for updates when component mounts (default: true)
 * @param options.checkInterval Interval in milliseconds to check for updates (default: null, no interval)
 * @param options.channel Channel to check for updates (default: null, uses configured channel)
 * @returns Update state and control functions
 */
export function useOTAUpdates(options: {
  checkOnMount?: boolean;
  checkInterval?: number | null;
  channel?: string | null;
} = {}) {
  const {
    checkOnMount = true,
    checkInterval = null,
  } = options;

  const [state, setState] = useState<UpdateCheckResult>({
    isUpdateAvailable: false,
    isUpdatePending: false,
    isChecking: false,
    error: null,
    manifest: null,
  });

  /**
   * OTA checks are unsupported in development builds.
   * We gate with both Updates.isEnabled and !__DEV__.
   */
  const isEnabled = Updates.isEnabled && !__DEV__;

  /**
   * Check for available updates
   */
  const checkForUpdate = useCallback(async (): Promise<boolean> => {
    if (!isEnabled) {
      console.log('[OTA] Skipping update check (disabled or development build)');
      return false;
    }

    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      const update = await Updates.checkForUpdateAsync();
      
      if (update.isAvailable) {
        setState((prev) => ({
          ...prev,
          isUpdateAvailable: true,
          isChecking: false,
          manifest: update.manifest,
        }));
        return true;
      } else {
        setState((prev) => ({
          ...prev,
          isUpdateAvailable: false,
          isChecking: false,
        }));
        return false;
      }
    } catch (error) {
      const updateError = error instanceof Error ? error : new Error(String(error));

      // In some runtimes this API can still be unavailable; treat it as non-fatal.
      if (updateError.message.includes('not supported in development builds')) {
        console.log('[OTA] Update check skipped in development build');
        setState((prev) => ({
          ...prev,
          isChecking: false,
          error: null,
        }));
        return false;
      }

      console.error('[OTA] Error checking for update:', updateError);
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error: updateError,
      }));
      return false;
    }
  }, [isEnabled]);

  /**
   * Download and apply the available update
   */
  const fetchAndApplyUpdate = async (): Promise<boolean> => {
    if (!isEnabled) {
      console.log('[OTA] Updates are not enabled in this environment');
      return false;
    }

    if (!state.isUpdateAvailable) {
      console.log('[OTA] No update available to fetch');
      return false;
    }

    setState((prev) => ({ ...prev, isChecking: true, error: null }));

    try {
      const result = await Updates.fetchUpdateAsync();
      
      if (result.isNew) {
        setState((prev) => ({
          ...prev,
          isUpdatePending: true,
          isChecking: false,
          manifest: result.manifest,
        }));
        
        // Reload the app to apply the update
        await Updates.reloadAsync();
        return true;
      } else {
        setState((prev) => ({
          ...prev,
          isUpdateAvailable: false,
          isChecking: false,
        }));
        return false;
      }
    } catch (error) {
      const updateError = error instanceof Error ? error : new Error(String(error));
      console.error('[OTA] Error fetching update:', updateError);
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error: updateError,
      }));
      return false;
    }
  };

  /**
   * Check for updates and automatically download/apply if available
   */
  const checkAndApplyUpdate = async (): Promise<boolean> => {
    const hasUpdate = await checkForUpdate();
    if (hasUpdate) {
      return await fetchAndApplyUpdate();
    }
    return false;
  };

  /**
   * Get current update info
   */
  const getUpdateInfo = () => {
    return {
      updateId: Updates.updateId,
      createdAt: Updates.createdAt,
      runtimeVersion: Updates.runtimeVersion,
      channel: Updates.channel,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    };
  };

  // Check for updates on mount if enabled
  useEffect(() => {
    if (!checkOnMount || !isEnabled) {
      return;
    }

    // Small delay to avoid blocking app startup
    const timer = setTimeout(() => {
      checkForUpdate();
    }, 2000);

    return () => clearTimeout(timer);
  }, [checkOnMount, isEnabled, checkForUpdate]);

  // Set up interval checking if configured
  useEffect(() => {
    if (!checkInterval || !isEnabled) {
      return;
    }

    const interval = setInterval(() => {
      checkForUpdate();
    }, checkInterval);

    return () => clearInterval(interval);
  }, [checkInterval, isEnabled, checkForUpdate]);

  return {
    ...state,
    isEnabled,
    checkForUpdate,
    fetchAndApplyUpdate,
    checkAndApplyUpdate,
    getUpdateInfo,
  };
}
