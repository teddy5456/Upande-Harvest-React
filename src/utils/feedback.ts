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
  } catch (e) {
    console.warn('[feedback] Failed to preload sounds:', e);
  }
}

export async function unloadSounds(): Promise<void> {
  await scanSuccessSound?.unloadAsync();
  await scanErrorSound?.unloadAsync();
  scanSuccessSound = null;
  scanErrorSound = null;
}

export async function onScanSuccess(): Promise<void> {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
