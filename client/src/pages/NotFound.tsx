import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="max-w-xl mx-auto px-4 py-20 text-center">
      <p className="text-6xl font-bold text-indigo-600 dark:text-indigo-400" dir="ltr">404</p>
      <h1 className="mt-4 text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('notFound.title')}</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">{t('notFound.description')}</p>
      <Link
        to="/"
        className="inline-block mt-8 px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
      >
        {t('notFound.backHome')}
      </Link>
    </div>
  );
}
