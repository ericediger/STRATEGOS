import { Routes, Route, Navigate } from 'react-router-dom';
import { ProjectList } from './pages/ProjectList';
import { Dashboard } from './pages/Dashboard';
import { Collaboration } from './pages/Collaboration';
import { DossierLibrary } from './pages/DossierLibrary';
import { DossierDetail } from './pages/DossierDetail';
import { AppHeader } from './components/AppHeader';

export default function App() {
  return (
    <div className="min-h-screen bg-surface">
      <AppHeader />
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/project/:projectId" element={<Dashboard />} />
        <Route path="/project/:projectId/collaborate" element={<Collaboration />} />
        <Route path="/dossiers" element={<DossierLibrary />} />
        <Route path="/dossiers/:id" element={<DossierDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
