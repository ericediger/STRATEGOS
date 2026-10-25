/**
 * Error message utilities for user-friendly error display
 */

export function friendlyErrorMessage(error: string | null): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  const lower = error.toLowerCase();

  if (lower.includes('rate limit')) {
    return 'The AI service is temporarily busy. Please try again in a few minutes.';
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The operation took too long. Please try again.';
  }

  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401')) {
    return 'There is a configuration issue. Please contact your administrator.';
  }

  if (lower.includes('econnrefused') || lower.includes('unavailable') || lower.includes('503')) {
    return 'A required service is temporarily unavailable. Please try again shortly.';
  }

  if (lower.includes('network') || lower.includes('fetch')) {
    return 'A network error occurred. Please check your connection and try again.';
  }

  // If the error message is short and user-friendly, use it as-is
  if (error.length < 100 && !lower.includes('error:') && !lower.includes('exception')) {
    return error;
  }

  return 'An unexpected error occurred. Please try again.';
}
