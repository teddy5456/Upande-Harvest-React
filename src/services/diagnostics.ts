/**
 * Diagnostics — forensic bundle attached to every support report.
 *
 * Captures the things a developer needs to verify a user's claim:
 *   - App + JS bundle version, device + OS, free disk
 *   - Logged-in user + server URL
 *   - Network state
 *   - Last API calls (success + failures) from the ring buffer in api.ts
 *   - Pending sync queue size + last sync timestamp
 *
 * Everything here is captured in the moment the user taps "Contact Support";
 * the user cannot edit any of it before submission.
 */
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { getApiTraces, ApiCallTrace } from './api';
import { getApiUrl, getSid, getUserEmail, getFullName } from '../database/settings';
import { getPendingCount, getFailedCount } from '../database/sync-queue';

export interface DiagnosticBundle {
  capturedAt: string;
  app: {
    name: string;
    version: string;
    nativeBuildVersion: string;
    bundleId: string;
    runtimeVersion: string;
    updateId: string;
    channel: string;
  };
  device: {
    platform: string;
    osVersion: string;
    manufacturer: string;
    modelName: string;
    deviceName: string;
    isDevice: boolean;
  };
  user: {
    email: string;
    fullName: string;
    serverUrl: string;
    hasSid: boolean;
  };
  network: {
    online: boolean;
  };
  sync: {
    pending: number;
    failed: number;
  };
  apiTraces: ApiCallTrace[];
}

export async function captureDiagnostics(opts: { online: boolean }): Promise<DiagnosticBundle> {
  const [serverUrl, sid, userEmail, fullName, pending, failed] = await Promise.all([
    getApiUrl(),
    getSid(),
    getUserEmail(),
    getFullName(),
    safe(() => getPendingCount(), 0),
    safe(() => getFailedCount(), 0),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    app: {
      name: Application.applicationName || 'mona-shelve',
      version: Application.nativeApplicationVersion || 'unknown',
      nativeBuildVersion: Application.nativeBuildVersion || 'unknown',
      bundleId: Application.applicationId || 'unknown',
      runtimeVersion: (Updates as any).runtimeVersion || 'unknown',
      updateId: Updates.updateId || 'embedded',
      channel: (Updates as any).channel || 'unknown',
    },
    device: {
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      manufacturer: Device.manufacturer || 'unknown',
      modelName: Device.modelName || 'unknown',
      deviceName: Device.deviceName || 'unknown',
      isDevice: Device.isDevice ?? true,
    },
    user: {
      email: userEmail || '(not signed in)',
      fullName: fullName || '(unknown)',
      serverUrl: serverUrl || '(not set)',
      hasSid: !!sid,
    },
    network: {
      online: !!opts.online,
    },
    sync: {
      pending: pending ?? 0,
      failed: failed ?? 0,
    },
    apiTraces: getApiTraces(),
  };
}

/** Pretty-printed JSON for embedding in the Frappe Issue description. */
export function bundleToText(b: DiagnosticBundle): string {
  return JSON.stringify(b, null, 2);
}

async function safe<T>(fn: () => Promise<T> | T, fallback: T): Promise<T> {
  try {
    const v = await fn();
    return (v === undefined || v === null) ? fallback : v;
  } catch {
    return fallback;
  }
}
