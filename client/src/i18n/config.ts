import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './he.json';
import en from './en.json';

function readSavedLanguage(): string {
  try {
    return localStorage.getItem('language') || 'he';
  } catch {
    return 'he';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en }
  },
  lng: readSavedLanguage(),
  fallbackLng: 'he',
  interpolation: {
    escapeValue: false
  }
});

export default i18n;
