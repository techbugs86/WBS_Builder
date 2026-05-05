import * as React from 'react';
import { cn } from '../../lib/utils';

// All colour values come from CSS variables so badges adapt to light/dark theme.
// Only three semantic colours (success/warning/error) plus the primary accent.
// Domain badges share the same muted style — domain is communicated by label, not colour.

const BASE = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide transition-colors';

const VARIANT_STYLES: Record<string, React.CSSProperties> = {
  default: {
    background: 'rgba(124,58,237,0.1)',
    color: 'var(--accent-text)',
    boxShadow: 'inset 0 0 0 1px rgba(124,58,237,0.25)',
  },
  pending: {
    background: 'var(--warning-bg)',
    color: 'var(--warning-text)',
    boxShadow: 'inset 0 0 0 1px var(--warning-border)',
  },
  approved: {
    background: 'var(--success-bg)',
    color: 'var(--success-text)',
    boxShadow: 'inset 0 0 0 1px var(--success-border)',
  },
  flagged: {
    background: 'var(--error-bg)',
    color: 'var(--error-text)',
    boxShadow: 'inset 0 0 0 1px var(--error-border)',
  },
  outline: {
    color: 'var(--text-muted)',
    boxShadow: 'inset 0 0 0 1px var(--border)',
  },
  muted: {
    background: 'var(--bg-overlay)',
    color: 'var(--text-muted)',
    boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
  },
  // Domain badges — all use the same neutral style; label carries the meaning
  'domain-auth':          { background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' },
  'domain-billing':       { background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' },
  'domain-search':        { background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' },
  'domain-messaging':     { background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' },
  'domain-profile':       { background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' },
  'domain-admin':         { background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' },
  'domain-notifications': { background: 'var(--bg-overlay-md)', color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border)' },
};

export type BadgeVariant = keyof typeof VARIANT_STYLES;

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

export const Badge = ({ className, variant = 'default', style, ...props }: BadgeProps) => (
  <div
    className={cn(BASE, className)}
    style={{ ...VARIANT_STYLES[variant], ...style }}
    {...props}
  />
);
