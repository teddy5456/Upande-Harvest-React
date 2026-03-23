import { useState, useEffect, useRef, useCallback } from 'react';
import * as Network from 'expo-network';
import { AppState, AppStateStatus } from 'react-native';

// When online: check every 30s (was causing Honeywell WiFi drops at 5s)
// When offline: back off to give the device WiFi stack room to scan/reconnect
const ONLINE_INTERVAL  = 30_000;  // 30s
const OFFLINE_FIRST    = 60_000;  // 60s — first wait after going offline
const OFFLINE_MAX      = 120_000; // 120s — subsequent waits

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const appState      = useRef<AppStateStatus>(AppState.currentState);
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef    = useRef(true);
  const offlineCount  = useRef(0); // consecutive offline checks

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Forward-declared so scheduleNext can reference check and vice-versa
  const scheduleNextRef = useRef<(connected: boolean) => void>(() => {});

  const check = useCallback(async (): Promise<boolean> => {
    if (appState.current !== 'active') return false;
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

    let delay: number;
    if (connected) {
      offlineCount.current = 0;
      delay = ONLINE_INTERVAL;
    } else {
      // Back off when offline — let the Honeywell WiFi stack breathe
      offlineCount.current += 1;
      delay = offlineCount.current === 1 ? OFFLINE_FIRST : OFFLINE_MAX;
    }

    timerRef.current = setTimeout(async () => {
      const result = await check();
      scheduleNextRef.current(result);
    }, delay);
  }, [check]);

  // Keep ref in sync so the timeout closure always calls the latest version
  useEffect(() => { scheduleNextRef.current = scheduleNext; }, [scheduleNext]);

  // Exposed so SyncBanner can offer a manual "Retry" button
  const forceCheck = useCallback(async () => {
    clearTimer();
    const result = await check();
    scheduleNextRef.current(result);
  }, [check]);

  useEffect(() => {
    mountedRef.current = true;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prev = appState.current;
      appState.current = nextState;
      if (prev !== 'active' && nextState === 'active') {
        // Foreground — check immediately (without waiting for next scheduled slot)
        forceCheck();
      } else if (nextState === 'background' || nextState === 'inactive') {
        // Background — stop all timers so WiFi radio can fully rest
        clearTimer();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial check on mount
    (async () => {
      const result = await check();
      scheduleNextRef.current(result);
    })();

    return () => {
      mountedRef.current = false;
      clearTimer();
      subscription.remove();
    };
  }, [check, forceCheck]);

  return { isConnected, forceCheck };
}
