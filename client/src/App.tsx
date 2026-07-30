import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LandingPage from './pages/LandingPage';
import DraftPage from './pages/DraftPage';
import AboutPage from './pages/AboutPage';
import HistoryPage from './pages/HistoryPage';
import LanguageSwitcher from './components/LanguageSwitcher';
import Footer from './components/Footer';
import { BUG_REPORT_MAILTO_HREF } from './utils/bugReport';
import './App.css';

export default function App() {
  const { t } = useTranslation();

  return (
    <BrowserRouter>
      <header className="command-bar">
        <NavLink to="/" className="wordmark" end>
          DotaDraft
        </NavLink>
        <nav className="command-nav">
          <NavLink to="/draft" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('app.nav.draft')}
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('app.nav.about')}
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('app.nav.history')}
          </NavLink>
          <a href={BUG_REPORT_MAILTO_HREF}>{t('app.nav.reportBug')}</a>
          <LanguageSwitcher />
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/draft" element={<DraftPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  );
}
