import { getLocales } from 'expo-localization';
import i18n, { resources } from './i18n';
import { readKey, writeKey } from './keychain';

export type LanguageChoice = 'system' | keyof typeof resources;
const KEY = 'language';

function deviceLanguage() {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return code in resources ? code : 'en';
}

/** The saved choice (`system` follows the iPhone language). */
export async function savedLanguage(): Promise<LanguageChoice> {
  const value = await readKey(KEY).catch(() => null);
  return value && value in resources ? (value as LanguageChoice) : 'system';
}

/** Applies the saved language at launch. */
export async function applySavedLanguage() {
  const choice = await savedLanguage();
  if (choice !== 'system' && i18n.language !== choice) await i18n.changeLanguage(choice);
}

/** Changes the app language and remembers it on this iPhone. */
export async function setLanguage(choice: LanguageChoice) {
  await writeKey(KEY, choice).catch(() => undefined);
  await i18n.changeLanguage(choice === 'system' ? deviceLanguage() : choice);
}
