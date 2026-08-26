import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { setSetting } from '../database/settings';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

/**
 * There is no other net under the app — a render throw anywhere used to
 * just go black, with zero information: the diagnostic bundle attached to
 * a support ticket is only captured when the user manually taps "Contact
 * Support" afterwards, by which point the API-trace ring buffer has long
 * since rolled past whatever actually broke. This is the one place a crash
 * is ever recorded, and it stashes what broke so the NEXT diagnostic bundle
 * (captureDiagnostics) can surface it automatically instead of everyone
 * guessing from a black screen.
 */
function stashCrash(error: any, extra?: Record<string, any>) {
  setSetting('lastCrash', JSON.stringify({
    message: error?.message || String(error),
    stack: error?.stack || null,
    at: new Date().toISOString(),
    ...extra,
  })).catch(() => {});
}

// ErrorBoundary only catches throws during React's render phase — a crash
// inside a promise callback or event handler (just as capable of going
// straight to a black screen) skips it entirely. This is RN's own
// lower-level hook for exactly that gap; registered once at module load,
// same "stash it so the next diagnostic bundle can see it" pattern, then
// hands off to whatever handler RN already had (its own red-box / native
// crash reporting still runs — this only adds the stash).
declare const ErrorUtils: {
  getGlobalHandler(): (error: any, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: any, isFatal?: boolean) => void): void;
} | undefined;

if (typeof ErrorUtils !== 'undefined') {
  const defaultHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    stashCrash(error, { fatal: !!isFatal, source: 'global' });
    defaultHandler(error, isFatal);
  });
}

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    stashCrash(error, { componentStack: info?.componentStack || null, source: 'render' });
  }

  handleRestart = () => {
    this.setState({ error: null });
    Updates.reloadAsync().catch(() => {});
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <TouchableOpacity style={styles.btn} onPress={this.handleRestart} activeOpacity={0.8}>
            <Text style={styles.btnText}>Restart</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  title: { fontFamily: fontFamily.semiBold, fontSize: fontSize.lg, color: colors.text },
  message: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
  },
  btnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textOnPrimary },
});
