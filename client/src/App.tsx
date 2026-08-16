import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, NavLink, useLocation } from 'react-router-dom';
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

// Keyed by pathname so React remounts this div on every route change.
// Two reasons it survives the move to view transitions: it re-triggers the
// CSS fallback animation for browsers without the View Transitions API
// (App.css), and it keeps each page's mount semantics identical to before —
// DraftPage in particular expects a fresh mount per visit.
function RootLayout() {
  const location = useLocation();
  return (
    <>
      <SiteHeader />
      <main className="app-main">
        <div key={location.pathname} className="page-transition">
          <Outlet />
        </div>
      </main>
      <Footer />
      <LegendPanel />
    </>
  );
}

const NAV_ITEMS = [
  { to: '/draft', key: 'app.nav.draft' },
  { to: '/about', key: 'app.nav.about' },
  { to: '/history', key: 'app.nav.history' },
  { to: '/leaderboard', key: 'app.nav.leaderboard' },
] as const;

// Forge crest — abstract stamp (not a Valve asset). Outer octagon reads as
// a Dota-style panel chamfer; inner diamond is the existing wordmark core.
function Mark() {
  return (
    <svg className="wordmark-mark" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <path
        d="M10 2h12l8 8v12l-8 8H10l-8-8V10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.55"
      />
      <path d="M16 5 27 16 16 27 5 16Z" fill="currentColor" opacity="0.12" />
      <path d="M16 9 23 16 16 23 9 16Z" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.85" />
      <path d="M16 12.5 19.5 16 16 19.5 12.5 16Z" fill="currentColor" />
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
        <NavLink to="/" className="wordmark" onClick={closeMenu} viewTransition end>
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
              viewTransition
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

// Data router rather than <BrowserRouter>: the `viewTransition` prop on
// Link/NavLink is driven by the data router's navigation flow and is a
// silent no-op under the component router — clicking a nav link simply
// never called document.startViewTransition.
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/draft', element: <DraftPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/history', element: <HistoryPage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      // Testing-only calibration matrix. import.meta.env.DEV is statically
      // false in a production build, so this branch is dead code Rollup drops.
      // The page is pulled in with a DYNAMIC import (not a static top-level
      // one): DebugMatrixPage.tsx side-effect-imports its own CSS, and a
      // static import of a module with side effects is kept in the bundle even
      // when the only reference sits in a dead branch — so a static import
      // would leak the page's CSS and its /dev/hero-matrix call into
      // production. Behind `lazy` the whole graph lives in a chunk that dead
      // code never reaches, so it's genuinely absent from a prod build. The
      // server side is gated separately (app.module.ts).
      ...(import.meta.env.DEV
        ? [{ path: '/debug', lazy: () => import('./pages/DebugMatrixPage').then((m) => ({ Component: m.default })) }]
        : []),
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
