import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

export function AppHeader() {
  return (
    <nav className="border-b border-surface-border bg-surface-raised">
      <div className="max-w-5xl mx-auto px-6 py-2 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="Logo" className="h-8 w-auto" />
          <span className="text-sm font-display text-text-heading tracking-wide uppercase">Strategos</span>
        </Link>
        <Link
          to="/dossiers"
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors"
        >
          <BookOpen className="w-4 h-4" />
          Dossier Library
        </Link>
      </div>
    </nav>
  );
}
