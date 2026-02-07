import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import AntennaList from '../components/Antennas/AntennaList';

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { user, loading, changePassword } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) { setPasswordError(t('errors.passwordRequired')); return; }
    if (newPassword.length < 6) { setPasswordError(t('errors.passwordLength')); return; }
    if (newPassword !== confirmNewPassword) { setPasswordError(t('errors.passwordMismatch')); return; }

    setPasswordLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordSuccess(t('profile.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('incorrect') || message.includes('wrong')) {
        setPasswordError(t('profile.wrongPassword'));
      } else {
        setPasswordError(t('errors.serverError'));
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(i18n.language === 'he' ? 'he-IL' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        {t('profile.title')}
      </h1>

      {/* User Info Card */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{user.username}</div>
            {memberSince && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {t('profile.memberSince')}: {memberSince}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('profile.settings')}</h2>

        <div className="space-y-4">
          {/* Language */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('profile.language')}</label>
            <select
              value={i18n.language}
              onChange={e => handleLanguageChange(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
            >
              <option value="he">עברית</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Theme */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('profile.theme')}</label>
            <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5">
              {(['light', 'dark', 'system'] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => setTheme(opt)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    theme === opt
                      ? 'bg-white dark:bg-slate-600 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {opt === 'light' ? '☀️' : opt === 'dark' ? '🌙' : '💻'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('profile.changePassword')}</h2>

        <form onSubmit={handlePasswordChange} className="space-y-3">
          {passwordError && (
            <div className="p-3 text-sm text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg">
              {passwordError}
            </div>
          )}
          {passwordSuccess && (
            <div className="p-3 text-sm text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800 rounded-lg">
              {passwordSuccess}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('profile.currentPassword')}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
              autoComplete="current-password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('profile.newPassword')}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('profile.confirmNewPassword')}
            </label>
            <input
              type="password"
              value={confirmNewPassword}
              onChange={e => setConfirmNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={passwordLoading}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {passwordLoading ? '...' : t('profile.changePassword')}
          </button>
        </form>
      </div>

      {/* Antennas */}
      <AntennaList />
    </div>
  );
}
