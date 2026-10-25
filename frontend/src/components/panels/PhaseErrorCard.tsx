import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { friendlyErrorMessage } from '../../lib/errors';

export function PhaseErrorCard({
  title,
  errorMessage,
  onRetry,
  isRetrying,
}: {
  title: string;
  errorMessage: string | null;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-brand-magenta" />
        <h3 className="font-semibold text-brand-magenta">{title}</h3>
      </div>
      <p className="text-sm text-gray-700 mb-3">{friendlyErrorMessage(errorMessage)}</p>
      <button
        onClick={onRetry}
        disabled={isRetrying}
        className="px-4 py-2 bg-brand-blue text-white rounded hover:bg-brand-blue-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isRetrying ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Retrying...
          </>
        ) : (
          <>
            <RotateCcw className="w-4 h-4" />
            Retry
          </>
        )}
      </button>
    </div>
  );
}
