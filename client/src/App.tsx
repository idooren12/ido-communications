import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { UnitsProvider } from './contexts/UnitsContext';
import Header from './components/Layout/Header';
import Footer from './components/Layout/Footer';
import Home from './pages/Home';
import FriisCalculator from './pages/FriisCalculator';
import RFSafety from './pages/RFSafety';
import LOSPage from './pages/LOS';
import LoginPage from './pages/Login';
import ProfilePage from './pages/Profile';
import ComparePage from './pages/Compare';

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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/friis" element={<FriisCalculator />} />
          <Route path="/rf-safety" element={<RFSafety />} />
          <Route path="/los" element={<LOSPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/compare" element={<ComparePage />} />
        </Routes>
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
