import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from '../locales/ru.json';
import en from '../locales/en.json';

const resources = {
  ru: { translation: ru },
  en: { translation: en },
};

const STORAGE_KEY = 'idel-language';
const savedLanguage = (() => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'ru' || value === 'en' ? value : null;
  } catch {
    return null;
  }
})();

i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'ru',
    lng: savedLanguage ?? 'ru', // язык по умолчанию, если пользователь ещё не выбирал
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

// Persist the user's explicit language choice so it survives a reload.
i18n.on('languageChanged', (lng) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // localStorage unavailable (private mode, etc.) — safe to ignore.
  }
});

export default i18n;