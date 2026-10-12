import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { UnitsProvider } from './contexts/UnitsContext';
import Header from './components/Layout/Header';
import Footer from './components/Layout/Footer';
import ErrorBoundary from './components/Layout/ErrorBoundary';
import Home from './pages/Home';

// Every page except Home is loaded on demand, so the map (MapLibre, geotiff) and the
// charts / PDF export are only downloaded by users who open those pages.
const FriisCalculator = lazy(() => import('./pages/FriisCalculator'));
const RFSafety = lazy(() => import('./pages/RFSafety'));
const LOSPage = lazy(() => import('./pages/LOS'));
const LoginPage = lazy(() => import('./pages/Login'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const ComparePage = lazy(() => import('./pages/Compare'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageFallback() {
  const { t } = useTranslation();
  return <div className="py-20 text-center text-gray-500 dark:text-gray-400">{t('common.loading')}</div>;
}

function AppContent() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const isFullscreen = location.pathname === '/los';

  useEffect(() => {
    document.documentElement.dir = i18n.language === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className={isFullscreen ? '' : 'flex-1'}>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/friis" element={<FriisCalculator />} />
              <Route path="/rf-safety" element={<RFSafety />} />
              <Route path="/los" element={<LOSPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      {!isFullscreen && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <UnitsProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
      </UnitsProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
