import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMemo } from 'react';

interface ToolCardProps {
  icon: string;
  title: string;
  description: string;
  to: string;
}

function ToolCard({ icon, title, description, to }: ToolCardProps) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className="block p-6 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-lg transition-all group"
    >
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
        {title}
      </h3>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{description}</p>
      <div className="mt-4 text-sm font-medium text-indigo-600 dark:text-indigo-400">
        {t('home.open')} &rarr;
      </div>
    </Link>
  );
}

interface ComingSoonCardProps {
  title: string;
  description?: string;
}

function ComingSoonCard({ title, description }: ComingSoonCardProps) {
  return (
    <div className="p-6 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 opacity-60">
      <div className="text-3xl mb-3">🔜</div>
      <h3 className="text-lg font-semibold text-gray-500 dark:text-gray-400">{title}</h3>
      {description && <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">{description}</p>}
    </div>
  );
}

function useGreeting() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return t('home.greeting.morning');
    if (hour >= 12 && hour < 17) return t('home.greeting.afternoon');
    if (hour >= 17 && hour < 21) return t('home.greeting.evening');
    return t('home.greeting.night');
  }, [t]);

  if (user) {
    return `${t('home.greeting.hello')} ${user.username}, ${greeting}`;
  }
  return greeting;
}

export default function Home() {
  const { t } = useTranslation();
  const greeting = useGreeting();

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100">
          {greeting}
        </h1>
        <p className="mt-3 text-lg text-gray-600 dark:text-gray-400">
          {t('home.subtitle')}
        </p>
      </div>

      {/* LOS Calculation - First */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">🗺️</span>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">{t('home.planningTools')}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ToolCard
            icon="👁️"
            title={t('home.losCard.title')}
            description={t('home.losCard.description')}
            to="/los"
          />
          <ComingSoonCard title={t('home.fresnelCard.title')} description={t('home.fresnelCard.comingSoon')} />
        </div>
      </section>

      {/* Antenna Data Calculators - Second */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">📡</span>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">{t('home.antennaTools')}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ToolCard
            icon="📶"
            title={t('home.friisCard.title')}
            description={t('home.friisCard.description')}
            to="/friis"
          />
          <ToolCard
            icon="⚠️"
            title={t('home.rfSafetyCard.title')}
            description={t('home.rfSafetyCard.description')}
            to="/rf-safety"
          />
          <ComingSoonCard title={t('home.linkBudgetCard.title')} description={t('home.linkBudgetCard.comingSoon')} />
        </div>
      </section>
    </div>
  );
}
