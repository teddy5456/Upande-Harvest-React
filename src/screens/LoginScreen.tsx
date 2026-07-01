import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { loginToServer, fetchUserRoles } from '../services/api';
import { setSetting, getApiUrl, getUserEmail, setUserRoles as storeUserRoles } from '../database/settings';
import { setSid, setCsrfToken, setFullName as storeFullName, setUserEmail as storeUserEmail } from '../database/settings';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';
import {
  biometricSupported,
  hasEnrolledCredentials,
  enrollCredentials,
  unlockCredentials,
  markEnrolled,
  hasBeenOffered,
  markOffered,
} from '../services/auth';

export default function LoginScreen() {
  const { setLoggedIn, setFullName, setUserEmail, setIsXflora, setUserRoles } = useApp();
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Biometric-enrolment state
  const [bioReady, setBioReady] = useState(false);     // device supports + enrolled in OS
  const [hasStoredCreds, setHasStoredCreds] = useState(false); // user enrolled in this app before
  const [showForm, setShowForm] = useState(true);
  const [bioPrompting, setBioPrompting] = useState(false);
  const [bioLabel, setBioLabel] = useState('Sign in with fingerprint');

  useEffect(() => {
    (async () => {
      const [savedUrl, savedEmail, bio, enrolled] = await Promise.all([
        getApiUrl(), getUserEmail(),
        biometricSupported(), hasEnrolledCredentials(),
      ]);
      if (savedUrl) setServerUrl(savedUrl);
      if (savedEmail) setEmail(savedEmail);
      // Treat the device as "ready" if hardware is available — even if the OS
      // hasn't been enrolled in fingerprint, the OS will fall back to device
      // PIN/pattern via authenticateAsync({disableDeviceFallback:false}).
      setBioReady(bio.available);
      setHasStoredCreds(enrolled);
      // If the user has stored credentials on this device, hide the form by default
      if (enrolled) setShowForm(false);
      // Label by capability — Face ID > Fingerprint > Device PIN fallback
      const types = bio.types || [];
      if (types.includes(2)) setBioLabel('Sign in with Face ID');
      else if (types.includes(1)) setBioLabel('Sign in with fingerprint');
      else setBioLabel('Sign in with device PIN');
    })();
  }, []);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const completeLogin = async (response: Awaited<ReturnType<typeof loginToServer>>) => {
    await setSetting('api_url', serverUrl.trim().replace(/\/+$/, ''));
    await setSid(response.sid);
    if (response.csrf_token) await setCsrfToken(response.csrf_token);
    await storeFullName(response.full_name);
    await storeUserEmail(response.user);

    setFullName(response.full_name);
    setUserEmail(response.user);
    setIsXflora(serverUrl.toLowerCase().includes('xflora'));

    try {
      const rolesResp = await fetchUserRoles();
      const roles = rolesResp.roles ?? [];
      await storeUserRoles(roles);
      setUserRoles(roles);
    } catch {
      // Non-critical
    }

    setLoggedIn(true);
  };

  const handleBiometricLogin = async () => {
    setError('');
    setBioPrompting(true);
    try {
      const creds = await unlockCredentials('Sign in to Mona Shelve');
      if (!creds) {
        setError('Fingerprint cancelled — use password instead');
        setShowForm(true);
        return;
      }
      // Pre-fill form values so the user sees the email they're signing in as
      setServerUrl(creds.serverUrl);
      setEmail(creds.email);
      const response = await loginToServer(creds.serverUrl, creds.email, creds.password);
      await markEnrolled(creds);
      await completeLogin(response);
    } catch (err: any) {
      setError(err.message || 'Could not sign in. Please try with your password.');
      setShowForm(true);
    } finally {
      setBioPrompting(false);
    }
  };

  const offerEnrolment = async (afterCreds: { serverUrl: string; email: string; password: string }) => {
    // Only ever offer ONCE per device. After that, the user toggles enrolment
    // via Settings → Account → Fingerprint sign-in.
    if (!bioReady || hasStoredCreds) return;
    if (await hasBeenOffered()) return;
    await markOffered();
    Alert.alert(
      'Enable fingerprint sign-in?',
      'Skip typing your password next time. Your credentials are stored on this device only, protected by your fingerprint or device PIN. You can turn this on or off later in Settings.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Enable',
          onPress: async () => {
            const ok = await enrollCredentials({ ...afterCreds, enrolledAt: new Date().toISOString() });
            if (!ok) {
              Alert.alert('Not enabled', 'Fingerprint enrolment was cancelled. You can enable it later from Settings.');
            } else {
              setHasStoredCreds(true);
            }
          },
        },
      ],
    );
  };

  const handleLogin = async () => {
    if (!serverUrl.trim()) {
      setError('Server URL is required');
      return;
    }
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await loginToServer(serverUrl.trim(), email.trim(), password);
      await completeLogin(response);
      // Offer biometric enrolment after successful manual login — only the first time.
      await offerEnrolment({ serverUrl: serverUrl.trim(), email: email.trim(), password });
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="leaf" size={32} color={colors.primary} />
          </View>
          <Text style={styles.appName}>Upande Harvest</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        {hasStoredCreds && !showForm && (
          <View style={styles.bioCard}>
            <Text style={styles.bioGreeting}>Welcome back{email ? `, ${email}` : ''}</Text>
            <TouchableOpacity
              style={[styles.bioBtn, bioPrompting && styles.bioBtnDisabled]}
              onPress={handleBiometricLogin}
              disabled={bioPrompting}
            >
              {bioPrompting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="finger-print" size={22} color="#fff" />
                  <Text style={styles.bioBtnText}>{bioLabel}</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowForm(true)} style={styles.bioSwitch}>
              <Text style={styles.bioSwitchText}>Use password instead</Text>
            </TouchableOpacity>
            {!!error && <Text style={styles.errorText}>{error}</Text>}
          </View>
        )}

        {(!hasStoredCreds || showForm) && (
        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server URL</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="globe-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="erp.yourcompany.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!loading}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="user@company.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!loading}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, styles.passwordInput]}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                editable={!loading}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>
          </View>

          {error ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="log-in-outline" size={20} color="#fff" />
                <Text style={styles.loginButtonText}>Sign In</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryMuted,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  appName: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    ...shadow.md,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputIcon: {
    paddingLeft: spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: fontFamily.regular,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
  },
  passwordInput: {
    paddingRight: 44,
  },
  eyeButton: {
    position: 'absolute',
    right: 0,
    padding: spacing.md,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.06)',
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  errorText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.error,
  },
  bioCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
    ...(shadow as any),
  },
  bioGreeting: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
  bioBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  bioBtnDisabled: { opacity: 0.6 },
  bioBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: '#fff',
  },
  bioSwitch: { paddingVertical: spacing.sm },
  bioSwitchText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  loginButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontFamily: fontFamily.bold,
    color: '#fff',
    fontSize: fontSize.md,
  },
});
