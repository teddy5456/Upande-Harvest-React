import { useState, useEffect, useRef, useCallback } from 'react';
import * as Network from 'expo-network';
import { AppState, AppStateStatus } from 'react-native';
import { getApiUrl } from '../database/settings';

// When online: poll at a moderate rate so we catch drops within ~12 s.
// Faster than the old 30 s — avoids users being stuck "online" after signal loss.
// When offline (or forced offline): poll fast so reconnection is detected quickly.
const ONLINE_INTERVAL   = 12_000; // 12s (was 30s)
const OFFLINE_INTERVAL  =  8_000; //  8s

// After this many consecutive fetch failures we declare "app-level offline"
// regardless of what Android's ConnectivityManager says (it lies on Honeywell).
const FAILURE_THRESHOLD = 2;

// How long to wait for a server probe before giving up
const PROBE_TIMEOUT_MS  = 4_000;

// ─── Module-level bridge (shared between hook instance and api.ts) ────────────

let _consecutiveFailures = 0;
let _forcedOffline       = false;
let _setConnectedFn: ((v: boolean) => void) | null = null;
let _forceCheckFn:   (() => void)           | null = null;

/**
 * Call from api.ts after every successful fetch.
 * Immediately clears forced-offline and restores online state.
 */
export function notifyNetworkSuccess(): void {
  _consecutiveFailures = 0;
  if (_forcedOffline) {
    _forcedOffline = false;
    _setConnectedFn?.(true);
  }
}

/**
 * Call from api.ts whenever fetch throws a network-level error.
 * After FAILURE_THRESHOLD misses the app is forced into offline mode
 * regardless of what Android ConnectivityManager reports — this is the
 * fix for Honeywell devices where isConnected stays true even when the
 * WiFi radio has lost data-plane connectivity.
 */
export function notifyNetworkError(): void {
  _consecutiveFailures++;
  if (_consecutiveFailures >= FAILURE_THRESHOLD && !_forcedOffline) {
    _forcedOffline = true;
    _setConnectedFn?.(false);
  }
  // Kick off an immediate probe/check cycle
  _forceCheckFn?.();
}

// ─── Server probe ─────────────────────────────────────────────────────────────

/**
 * Lightweight HEAD request to the configured server URL.
 * Used when in forced-offline mode so we probe real connectivity
 * instead of trusting Android's ConnectivityManager.
 */
async function probeServer(): Promise<boolean> {
  try {
    let base = await getApiUrl();
    if (!base) return false;
    if (!base.startsWith('http')) base = `https://${base}`;
    base = base.replace(/\/+$/, '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      await fetch(base, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timer);
      return true;
    } catch {
      clearTimeout(timer);
      return false;
    }
  } catch {
    return false;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const appState   = useRef<AppStateStatus>(AppState.currentState);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Register the React state setter so module-level notifiers can update it
  useEffect(() => {
    _setConnectedFn = (v) => { if (mountedRef.current) setIsConnected(v); };
    return () => { _setConnectedFn = null; };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNextRef = useRef<(connected: boolean) => void>(() => {});

  const check = useCallback(async (): Promise<boolean> => {
    if (appState.current !== 'active') return false;

    // ── Forced-offline path (Honeywell fix) ──────────────────────────────────
    // Android reports isConnected=true on Honeywell even when the radio has
    // lost data-plane connectivity. When the API layer has flagged too many
    // consecutive failures we bypass getNetworkStateAsync entirely and do a
    // real HTTP probe against the configured server.
    if (_forcedOffline) {
      const reachable = await probeServer();
      if (reachable) {
        _forcedOffline       = false;
        _consecutiveFailures = 0;
      }
      if (mountedRef.current) setIsConnected(reachable);
      return reachable;
    }

    // ── Normal path: system-level check ──────────────────────────────────────
    try {
      const state = await Network.getNetworkStateAsync();
      // isInternetReachable can be null on Android — treat null as "unknown → assume connected"
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      if (mountedRef.current) setIsConnected(connected);
      return connected;
    } catch {
      if (mountedRef.current) setIsConnected(false);
      return false;
    }
  }, []);

  const scheduleNext = useCallback((connected: boolean) => {
    clearTimer();
    if (!mountedRef.current) return;
    // Poll fast when offline so the user sees reconnection within ~8 s
    const delay = connected ? ONLINE_INTERVAL : OFFLINE_INTERVAL;
    timerRef.current = setTimeout(async () => {
      const result = await check();
      scheduleNextRef.current(result);
    }, delay);
  }, [check]);

  useEffect(() => { scheduleNextRef.current = scheduleNext; }, [scheduleNext]);

  const forceCheck = useCallback(async () => {
    clearTimer();
    const result = await check();
    scheduleNextRef.current(result);
  }, [check]);

  // Register forceCheck for the module-level bridge
  useEffect(() => {
    _forceCheckFn = forceCheck;
    return () => { _forceCheckFn = null; };
  }, [forceCheck]);

  useEffect(() => {
    mountedRef.current = true;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prev = appState.current;
      appState.current = nextState;
      if (prev !== 'active' && nextState === 'active') {
        // Screen turned on — check immediately (Honeywell radios wake slowly)
        forceCheck();
      } else if (nextState === 'background' || nextState === 'inactive') {
        // Screen off — pause polling so the radio can fully rest
        clearTimer();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Subscribe to system-level network state changes so the app reacts
    // immediately when the OS detects a connection drop or recovery —
    // instead of waiting for the next poll cycle.
    // Wrapped in try/catch because the API was added in expo-network v5.4
    // and we want a safe fallback if it's somehow unavailable.
    let networkListener: { remove: () => void } | null = null;
    try {
      networkListener = Network.addNetworkStateListener(() => {
        if (mountedRef.current) forceCheck();
      });
    } catch {
      // Not available — polling-only fallback is still in place
    }

    (async () => {
      const result = await check();
      scheduleNextRef.current(result);
    })();

    return () => {
      mountedRef.current = false;
      clearTimer();
      subscription.remove();
      networkListener?.remove();
    };
  }, [check, forceCheck]);

  return { isConnected, forceCheck };
}
