import { File, Paths } from 'expo-file-system';

/**
 * When the app's signature expires. Sideloading tools (Impactor, SideStore, AltStore) sign with a free Apple ID for
 * 7 days and put the provisioning profile in the bundle as `embedded.mobileprovision`: a signed CMS file whose
 * payload is a plain XML plist, so `ExpirationDate` can be read as text. Null in unsigned or simulator builds.
 */
export function signatureExpiry(): Date | null {
  try {
    const file = new File(Paths.bundle, 'embedded.mobileprovision');
    if (!file.exists) return null;
    const bytes = file.bytesSync();
    let text = '';
    // Latin-1 keeps every byte; the plist part is ASCII.
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const match = /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/.exec(text);
    const date = match ? new Date(match[1]) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

/** Whole days left before `expiry` (0 on the last day, negative once expired). */
export function daysLeft(expiry: Date, now = new Date()) {
  return Math.floor((expiry.getTime() - now.getTime()) / 86400000);
}
