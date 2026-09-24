import type { ReactNode } from 'react';

/** Mowr is free; donations keep it that way. Paste the PayPal link here and deploy to switch the button on.
 *  While it is empty the button looks normal but does nothing when pressed. */
export const PAYPAL_URL = '';

export function SupportLink({ className = '', children }: { className?: string; children: ReactNode }) {
  if (PAYPAL_URL) return <a className={className} href={PAYPAL_URL} target="_blank" rel="noopener noreferrer">{children}</a>;
  return <a className={`${className} support-pending`} aria-disabled="true" role="link" tabIndex={-1} onClick={(e) => e.preventDefault()}>{children}</a>;
}
