import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import it from '../locales/it.json';

// Locale files are Crowdin-managed (see crowdin.yml); English is the source language.
export const resources = { en: { translation: en }, it: { translation: it } } as const;

const device = getLocales()[0]?.languageCode ?? 'en';

// eslint-disable-next-line import/no-named-as-default-member
i18n.use(initReactI18next).init({
  resources,
  lng: device in resources ? device : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
