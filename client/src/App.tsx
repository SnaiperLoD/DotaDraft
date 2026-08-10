import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LandingPage from './pages/LandingPage';
import DraftPage from './pages/DraftPage';
import AboutPage from './pages/AboutPage';
import HistoryPage from './pages/HistoryPage';
import LeaderboardPage from './pages/LeaderboardPage';
import LanguageSwitcher from './components/LanguageSwitcher';
import ThemeToggle from './components/ThemeToggle';
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

const NAV_ITEMS = [
  { to: '/draft', key: 'app.nav.draft' },
  { to: '/about', key: 'app.nav.about' },
  { to: '/history', key: 'app.nav.history' },
  { to: '/leaderboard', key: 'app.nav.leaderboard' },
] as const;

// Forge stamp — an abstract emblem, not a Dota asset. Paired with the
// wordmark so the header has a fixed anchor point at any width (the
// wordmark text itself is what drops out first on narrow screens).
function Mark() {
  return (
    <svg className="wordmark-mark" viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
      <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      <path d="M16 8 24 16 16 24 8 16Z" fill="currentColor" opacity="0.18" />
      <path d="M16 11 21 16 16 21 11 16Z" fill="currentColor" />
    </svg>
  );
}

function SiteHeader() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Every link closes the mobile panel on the way out — otherwise it stays
  // open over the page it just navigated to. Handled on the click rather
  // than by watching the pathname, which would be a setState cascading out
  // of an effect for something the click already knows.
  const closeMenu = () => setMenuOpen(false);

  // The header is sticky, so it needs to earn a shadow only once content
  // has scrolled underneath it — a permanent one reads as a floating bar
  // even at the top of the page. passive: the listener never preventDefaults.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`command-bar${scrolled ? ' command-bar--scrolled' : ''}`}>
      <div className="command-bar-inner">
        <NavLink to="/" className="wordmark" onClick={closeMenu} end>
          <Mark />
          <span className="wordmark-text">
            Dota<span className="wordmark-accent">Draft</span>
          </span>
        </NavLink>

        <nav className={`command-nav${menuOpen ? ' command-nav--open' : ''}`} id="primary-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
              onClick={closeMenu}
            >
              {t(item.key)}
            </NavLink>
          ))}
          <a href={BUG_REPORT_MAILTO_HREF} onClick={closeMenu}>
            {t('app.nav.reportBug')}
          </a>
        </nav>

        <div className="command-tools">
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            type="button"
            className="nav-burger"
            aria-label={t('app.nav.menu')}
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span
              className={`nav-burger-glyph${menuOpen ? ' nav-burger-glyph--open' : ''}`}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SiteHeader />
      <main className="app-main">
        <AppRoutes />
      </main>
      <Footer />
      <LegendPanel />
    </BrowserRouter>
  );
}
