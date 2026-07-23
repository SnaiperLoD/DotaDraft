import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import DraftPage from './pages/DraftPage';
import HistoryPage from './pages/HistoryPage';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <header className="command-bar">
        <NavLink to="/" className="wordmark" end>
          DotaDraft
        </NavLink>
        <nav className="command-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Draft
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            History
          </NavLink>
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
