import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LandingPage from './pages/LandingPage';
import DraftPage from './pages/DraftPage';
import AboutPage from './pages/AboutPage';
import HistoryPage from './pages/HistoryPage';
import LeaderboardPage from './pages/LeaderboardPage';
import LanguageSwitcher from './components/LanguageSwitcher';
import Footer from './components/Footer';
import LegendPanel from './components/LegendPanel';
import { BUG_REPORT_MAILTO_HREF } from './utils/bugReport';
import './App.css';

// Keyed by pathname so React remounts this div on every route change,
// re-triggering the CSS fade/rise-in animation (App.css's .page-transition)
// — cheaper than a transition-group library for a one-way "content just
// changed" cue, no exit animation needed since the old content is gone
// immediately either way (no crossfade).
function AppRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname} className="page-transition">
      <Routes location={location}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/draft" element={<DraftPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
      </Routes>
    </div>
  );
}

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
          <NavLink to="/leaderboard" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('app.nav.leaderboard')}
          </NavLink>
          <a href={BUG_REPORT_MAILTO_HREF}>{t('app.nav.reportBug')}</a>
          <LanguageSwitcher />
        </nav>
      </header>
      <main className="app-main">
        <AppRoutes />
      </main>
      <Footer />
      <LegendPanel />
    </BrowserRouter>
  );
}
