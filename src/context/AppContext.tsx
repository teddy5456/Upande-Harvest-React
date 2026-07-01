import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DashboardStats } from '../types';
import { getDashboardStats } from '../database/shelves';
import { getPendingCount, getFailedCount } from '../database/sync-queue';
import { syncPendingEntries, SyncResult } from '../services/sync';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { getDatabase } from '../database/database';
import {
  getSid, getApiUrl, clearAuth as clearAuthStorage,
  getFullName as getStoredFullName,
  getUserEmail as getStoredUserEmail,
  getUserRoles as getStoredUserRoles,
  getCachedStorageMode, setCachedStorageMode,
} from '../database/settings';
import { registerAuthFailureHandler, getStorageMode, StorageMode } from '../services/api';
import { preloadSounds, unloadSounds } from '../utils/feedback';
import { clearFarmCache } from '../utils/farm-cache';

export interface SyncLog {
  id: string;
  type: 'error' | 'success' | 'warning' | 'info';
  message: string;
  time: string;
}

interface AppContextType {
  isReady: boolean;
  isLoggedIn: boolean;
  isXflora: boolean;
  isHarvester: boolean;
  userRoles: string[];
  fullName: string;
  userEmail: string;
  stats: DashboardStats;
  pendingSync: number;
  failedSync: number;
  isConnected: boolean;
  isSyncing: boolean;
  lastSyncResult: SyncResult | null;
  logs: SyncLog[];
  storageMode: StorageMode;
  refreshStorageMode: () => Promise<void>;
  refreshStats: () => Promise<void>;
  triggerSync: (onProgress?: (done: number, total: number) => void) => Promise<void>;
  retryConnection: () => Promise<void>;
  pushLog: (type: SyncLog['type'], message: string) => void;
  setLoggedIn: (value: boolean) => void;
  setIsXflora: (value: boolean) => void;
  setFullName: (name: string) => void;
  setUserEmail: (email: string) => void;
  setUserRoles: (roles: string[]) => void;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextType>({
  isReady: false,
  isLoggedIn: false,
  isXflora: false,
  fullName: '',
  userEmail: '',
  stats: { total_shelves: 0, occupied_shelves: 0, empty_shelves: 0, total_buckets: 0, pending_sync: 0 },
  pendingSync: 0,
  failedSync: 0,
  isConnected: true,
  isSyncing: false,
  lastSyncResult: null,
  logs: [],
  storageMode: 'Shelving',
  refreshStorageMode: async () => {},
  refreshStats: async () => {},
  triggerSync: async () => {},
  retryConnection: async () => {},
  pushLog: () => {},
  setLoggedIn: () => {},
  setIsXflora: () => {},
  setFullName: () => {},
  setUserEmail: () => {},
  setUserRoles: () => {},
  logout: async () => {},
  isHarvester: false,
  userRoles: [],
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setLoggedIn] = useState(false);
  const [isXflora, setIsXflora] = useState(false);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [fullName, setFullName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const isHarvester = userRoles.some(r => r.toLowerCase().includes('harvest'));
  const [stats, setStats] = useState<DashboardStats>({
    total_shelves: 0, occupied_shelves: 0, empty_shelves: 0, total_buckets: 0, pending_sync: 0,
  });
  const [pendingSync, setPendingSync] = useState(0);
  const [failedSync, setFailedSync] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [storageMode, setStorageMode] = useState<StorageMode>('Shelving');
  const { isConnected, forceCheck } = useNetworkStatus();
  const syncInProgress = useRef(false);
  const prevConnected = useRef<boolean | null>(null);

  const pushLog = useCallback((type: SyncLog['type'], message: string) => {
    const entry: SyncLog = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setLogs(prev => [entry, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    (async () => {
      await getDatabase();
      await preloadSounds();
      // Restore storageMode from the local cache BEFORE we hand control back
      // to the UI, so screens don't flash the wrong slot layout during the
      // online-fetch round-trip (or when offline).
      const cachedMode = await getCachedStorageMode();
      if (cachedMode === 'Shelving' || cachedMode === 'Zoning' || cachedMode === 'Direct-to-Grader') {
        setStorageMode(cachedMode);
      }
      const auth = await getSid();
      if (auth) {
        setLoggedIn(true);
        const name = await getStoredFullName();
        const email = await getStoredUserEmail();
        const roles = await getStoredUserRoles();
        if (name) setFullName(name);
        if (email) setUserEmail(email);
        if (roles.length > 0) setUserRoles(roles);
        const url = await getApiUrl();
        setIsXflora(url.toLowerCase().includes('xflora'));
      }
      setIsReady(true);
    })();
    return () => { unloadSounds(); };
  }, []);

  // Log connectivity changes (skip initial mount)
  useEffect(() => {
    if (!isReady) return;
    if (prevConnected.current === null) {
      prevConnected.current = isConnected;
      return;
    }
    if (prevConnected.current !== isConnected) {
      if (!isConnected) {
        pushLog('warning', 'Went offline');
      } else {
        pushLog('info', 'Back online');
      }
      prevConnected.current = isConnected;
    }
  }, [isConnected, isReady, pushLog]);

  const refreshStorageMode = useCallback(async () => {
    try {
      const mode = await getStorageMode();
      setStorageMode(mode);
      // Persist so we survive a WiFi drop on the next launch / hot reload.
      await setCachedStorageMode(mode);
    } catch {
      // Leave whatever value (cached or default) is currently set. Old builds
      // and offline both land here; the cache from a prior online session is
      // good enough to keep the right slot layout.
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const s = await getDashboardStats();
      setStats(s);
      const p = await getPendingCount();
      setPendingSync(p);
      const f = await getFailedCount();
      setFailedSync(f);
    } catch {}
  }, []);

  const triggerSync = useCallback(async (onProgress?: (done: number, total: number) => void) => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setIsSyncing(true);
    try {
      const result = await syncPendingEntries(onProgress);
      setLastSyncResult(result);
      if (result.synced > 0) {
        pushLog('success', `Synced ${result.synced} entr${result.synced === 1 ? 'y' : 'ies'}`);
      }
      if (result.failed > 0) {
        pushLog('error', `${result.failed} entr${result.failed === 1 ? 'y' : 'ies'} failed to sync`);
      }
      await refreshStats();
    } catch (err: any) {
      pushLog('error', `Sync error: ${err?.message ?? 'Unknown error'}`);
    }
    setIsSyncing(false);
    syncInProgress.current = false;
  }, [refreshStats, pushLog]);

  const retryConnection = useCallback(async () => {
    pushLog('info', 'Checking connection…');
    await forceCheck();
  }, [forceCheck, pushLog]);

  const logout = useCallback(async () => {
    clearFarmCache();
    await clearAuthStorage();
    // Drop the in-memory cached credentials so a 401 won't silently re-log in
    // after the user has explicitly signed out. The biometric-gated secure
    // store blob is intentionally KEPT so they can biometric-unlock to sign
    // back in without retyping. Use "Remove fingerprint" in Settings to wipe.
    try {
      const { dropMemoryCache } = await import('../services/auth');
      dropMemoryCache();
    } catch { /* auth module unavailable */ }
    setLoggedIn(false);
    setFullName('');
    setUserEmail('');
    setUserRoles([]);
  }, []);

  useEffect(() => {
    if (isReady && isLoggedIn) refreshStats();
  }, [isReady, isLoggedIn, refreshStats]);

  // Pull storage_mode once on login + whenever connectivity restores.
  // Direct-to-Grader mode flips the bucket-scan step off in GradeScreen and
  // surfaces the Receiving Out tab — so we want a fresh read each session.
  useEffect(() => {
    if (isReady && isLoggedIn && isConnected) refreshStorageMode();
  }, [isReady, isLoggedIn, isConnected, refreshStorageMode]);

  // Wire up the API layer so any 401 response triggers an automatic logout.
  // This handles server URL migrations where the stored session is no longer
  // valid on the new instance.
  useEffect(() => {
    registerAuthFailureHandler(() => logout());
  }, [logout]);

  // Auto-sync when connectivity returns
  useEffect(() => {
    if (isConnected && isReady && isLoggedIn && pendingSync > 0) {
      const timer = setTimeout(() => triggerSync(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isConnected, isReady, isLoggedIn, pendingSync, triggerSync]);

  return (
    <AppContext.Provider
      value={{
        isReady,
        isLoggedIn,
        isXflora,
        isHarvester,
        userRoles,
        fullName,
        userEmail,
        stats,
        pendingSync,
        failedSync,
        isConnected,
        isSyncing,
        lastSyncResult,
        logs,
        storageMode,
        refreshStorageMode,
        refreshStats,
        triggerSync,
        retryConnection,
        pushLog,
        setLoggedIn,
        setIsXflora,
        setFullName,
        setUserEmail,
        setUserRoles,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
