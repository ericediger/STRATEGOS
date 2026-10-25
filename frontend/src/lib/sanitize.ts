/**
 * Sanitize HTML/markdown content before rendering to DOM.
 * Strips script tags, event handlers, and other XSS vectors
 * while preserving safe formatting (bold, italic, headers, links, etc.)
 */

import DOMPurify from 'dompurify';

export function sanitizeContent(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'strong', 'em', 'b', 'i', 'u', 's', 'del',
      'a', 'blockquote', 'pre', 'code',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'div', 'span', 'img',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'class', 'id'],
    ALLOW_DATA_ATTR: false,
  });
}
