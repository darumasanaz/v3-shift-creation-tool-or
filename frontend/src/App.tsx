import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ConfigPage from './pages/ConfigPage';
import ViewerPage from './pages/ViewerPage';
import WishOffsPage from './pages/WishOffsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewerPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/wish-offs" element={<WishOffsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
