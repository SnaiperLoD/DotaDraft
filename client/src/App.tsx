import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import DraftPage from './pages/DraftPage';
import HistoryPage from './pages/HistoryPage';

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ display: 'flex', gap: 16, padding: 16, borderBottom: '1px solid #333' }}>
        <Link to="/">Draft</Link>
        <Link to="/history">History</Link>
      </nav>
      <main style={{ padding: 16 }}>
        <Routes>
          <Route path="/" element={<DraftPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
