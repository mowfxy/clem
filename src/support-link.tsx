import type { ReactNode } from 'react';

/** Mowr is free; donations keep it that way. Paste the PayPal link here and deploy to switch the button on.
 *  While it is empty the button looks normal but does nothing when pressed. */
export const PAYPAL_URL = '';

export function SupportLink({ className = '', children }: { className?: string; children: ReactNode }) {
  if (PAYPAL_URL) return <a className={className} href={PAYPAL_URL} target="_blank" rel="noopener noreferrer">{children}</a>;
  return <a className={`${className} support-pending`} aria-disabled="true" role="link" tabIndex={-1} onClick={(e) => e.preventDefault()}>{children}</a>;
}

/** PayPal's two-P mark, for the donate button. */
export function PayPalMark({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#003087" d="M7.2 21.5H3.6a.5.5 0 0 1-.5-.6L5.9 3.1a.7.7 0 0 1 .7-.6h6.5c3.3 0 5.4 1.7 4.9 4.9-.6 3.8-3.1 5.6-6.7 5.6H9.4l-1.2 7.8a.7.7 0 0 1-.7.7Z" />
    <path fill="#009cde" d="M19.1 7.9c-.7 3.9-3.3 5.8-7 5.8h-1.7l-1.3 7.9h3.1a.6.6 0 0 0 .6-.5l.6-3.8h1.9c3 0 5.3-1.5 5.9-4.7.3-1.9-.3-3.3-2.1-4.7Z" />
  </svg>;
}
