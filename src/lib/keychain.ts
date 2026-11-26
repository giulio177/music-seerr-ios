import * as SecureStore from 'expo-secure-store';

/**
 * Keychain access for the app's saved values. Items stay readable after the first unlock since boot, so Shortcuts
 * and automations that start the app while the iPhone is locked still find the session. The iOS default
 * (`WHEN_UNLOCKED`) refused those reads and the app opened signed out.
 */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

/** Reads a value; throws when the keychain refuses (iPhone not unlocked since boot), `null` when it is missing. */
export const readKey = (key: string) => SecureStore.getItemAsync(key, OPTIONS);

/** Saves a value; also moves an existing item to the accessibility above. */
export const writeKey = (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS);

export const deleteKey = (key: string) => SecureStore.deleteItemAsync(key, OPTIONS);
