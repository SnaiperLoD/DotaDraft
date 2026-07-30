import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import DraftPage from './pages/DraftPage';
import HistoryPage from './pages/HistoryPage';
import LanguageSwitcher from './components/LanguageSwitcher';
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
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('app.nav.draft')}
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            {t('app.nav.history')}
          </NavLink>
          <a
            href={`mailto:snaiperlod19@gmail.com?subject=${encodeURIComponent(
              'DotaDraft Bug Report',
            )}&body=${encodeURIComponent('Describe what happened:\n\n\n(feel free to include the page URL and any other details)')}`}
          >
            {t('app.nav.reportBug')}
          </a>
          <LanguageSwitcher />
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<DraftPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
