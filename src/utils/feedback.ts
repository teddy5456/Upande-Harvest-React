import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

let scanSuccessSound: Audio.Sound | null = null;
let scanErrorSound: Audio.Sound | null = null;

export async function preloadSounds(): Promise<void> {
  try {
    const { sound: success } = await Audio.Sound.createAsync(
      require('../../assets/sounds/scan-success.wav'),
      { shouldPlay: false, volume: 0.6 }
    );
    scanSuccessSound = success;

    const { sound: error } = await Audio.Sound.createAsync(
      require('../../assets/sounds/scan-error.wav'),
      { shouldPlay: false, volume: 0.6 }
    );
    scanErrorSound = error;
  } catch {
    // sounds unavailable — continue without audio
  }
}

export async function unloadSounds(): Promise<void> {
  await scanSuccessSound?.unloadAsync();
  await scanErrorSound?.unloadAsync();
  scanSuccessSound = null;
  scanErrorSound = null;
}

export async function onScanSuccess(): Promise<void> {
  // Two-tap ascending pattern (light then medium, 80 ms apart) — feels like
  // a satisfying "ding-ding" rather than a single blunt buzz.
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 80);
  try {
    await scanSuccessSound?.setPositionAsync(0);
    await scanSuccessSound?.playAsync();
  } catch {}
}

export async function onScanError(): Promise<void> {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  try {
    await scanErrorSound?.setPositionAsync(0);
    await scanErrorSound?.playAsync();
  } catch {}
}

export function lightHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function lockHaptic(locking: boolean): void {
  if (locking) {
    // Lock: two heavy thuds — feels like a bolt sliding home
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 90);
  } else {
    // Unlock: light-medium-light — feels like a release
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 70);
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 140);
  }
}
