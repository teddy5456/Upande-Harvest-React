import React, {
  useRef,
  useState,
  useCallback,
  useContext,
  createContext,
} from 'react';
import { View } from 'react-native';
import SupportModal from './SupportModal';

/**
 * SupportFab — used to be a floating action button; is now a context-only
 * wrapper. It still owns the SupportModal + the screenshot-capture ref so
 * any screen can trigger the support modal via `useSupport()` without
 * losing the underlying screenshot of whatever the user was looking at.
 *
 * The visible trigger is rendered in the App.tsx header via `useSupport()`
 * so it sits in the top bar instead of covering content at the bottom.
 */

interface SupportContextValue {
  open: () => void;
}

const SupportContext = createContext<SupportContextValue>({ open: () => {} });

export function useSupport(): SupportContextValue {
  return useContext(SupportContext);
}

interface SupportFabProps {
  children: React.ReactNode;
}

export default function SupportFab({ children }: SupportFabProps) {
  const [open, setOpen] = useState(false);
  const captureTargetRef = useRef<View>(null);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <SupportContext.Provider value={{ open: handleOpen }}>
      <View style={{ flex: 1 }}>
        {/* Capture-target wrapper: the screenshot grabs whatever's inside this */}
        <View ref={captureTargetRef} collapsable={false} style={{ flex: 1 }}>
          {children}
        </View>

        <SupportModal
          visible={open}
          onClose={handleClose}
          screenshotTargetRef={captureTargetRef}
        />
      </View>
    </SupportContext.Provider>
  );
}
