import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { apiUpdatePreferences } from '../../utils/api';

export default function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const currentLang = i18n.language;

  const toggleLanguage = async () => {
    const newLang = currentLang === 'he' ? 'en' : 'he';
    i18n.changeLanguage(newLang);
    localStorage.setItem('language', newLang);
    document.documentElement.dir = newLang === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = newLang;

    if (user) {
      try {
        await apiUpdatePreferences(newLang);
      } catch {
        // Silently fail - preference saved locally
      }
    }
  };

  return (
    <button
      onClick={toggleLanguage}
      className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      aria-label={t('common.switchLanguage')}
      title={t('common.switchLanguage')}
    >
      {currentLang === 'he' ? 'EN' : 'HE'}
    </button>
  );
}
