import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { DashboardStats } from '../types';
import { getDashboardStats } from '../database/shelves';
import { getPendingCount, getFailedCount } from '../database/sync-queue';
import { syncPendingEntries, SyncResult } from '../services/sync';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { getDatabase } from '../database/database';
import { getAuthToken, getSid, clearAuth as clearAuthStorage, getFullName as getStoredFullName, getUserEmail as getStoredUserEmail } from '../database/settings';
import { preloadSounds, unloadSounds } from '../utils/feedback';

interface AppContextType {
  isReady: boolean;
  isLoggedIn: boolean;
  fullName: string;
  userEmail: string;
  stats: DashboardStats;
  pendingSync: number;
  failedSync: number;
  isConnected: boolean;
  isSyncing: boolean;
  lastSyncResult: SyncResult | null;
  refreshStats: () => Promise<void>;
  triggerSync: () => Promise<void>;
  setLoggedIn: (value: boolean) => void;
  setFullName: (name: string) => void;
  setUserEmail: (email: string) => void;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextType>({
  isReady: false,
  isLoggedIn: false,
  fullName: '',
  userEmail: '',
  stats: { total_shelves: 0, occupied_shelves: 0, empty_shelves: 0, total_buckets: 0, pending_sync: 0 },
  pendingSync: 0,
  failedSync: 0,
  isConnected: true,
  isSyncing: false,
  lastSyncResult: null,
  refreshStats: async () => {},
  triggerSync: async () => {},
  setLoggedIn: () => {},
  setFullName: () => {},
  setUserEmail: () => {},
  logout: async () => {},
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setLoggedIn] = useState(false);
  const [fullName, setFullName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [stats, setStats] = useState<DashboardStats>({
    total_shelves: 0, occupied_shelves: 0, empty_shelves: 0, total_buckets: 0, pending_sync: 0,
  });
  const [pendingSync, setPendingSync] = useState(0);
  const [failedSync, setFailedSync] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const isConnected = useNetworkStatus();
  const syncInProgress = useRef(false);

  useEffect(() => {
    (async () => {
      await getDatabase();
      await preloadSounds();
      const sid = await getSid();
      const auth = await getAuthToken();
      if (sid || auth) {
        setLoggedIn(true);
        const name = await getStoredFullName();
        const email = await getStoredUserEmail();
        if (name) setFullName(name);
        if (email) setUserEmail(email);
      }
      setIsReady(true);
    })();
    return () => { unloadSounds(); };
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

  const triggerSync = useCallback(async () => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setIsSyncing(true);
    try {
      const result = await syncPendingEntries();
      setLastSyncResult(result);
      await refreshStats();
    } catch {}
    setIsSyncing(false);
    syncInProgress.current = false;
  }, [refreshStats]);

  const logout = useCallback(async () => {
    await clearAuthStorage();
    setLoggedIn(false);
    setFullName('');
    setUserEmail('');
  }, []);

  useEffect(() => {
    if (isReady && isLoggedIn) refreshStats();
  }, [isReady, isLoggedIn, refreshStats]);

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
        fullName,
        userEmail,
        stats,
        pendingSync,
        failedSync,
        isConnected,
        isSyncing,
        lastSyncResult,
        refreshStats,
        triggerSync,
        setLoggedIn,
        setFullName,
        setUserEmail,
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
