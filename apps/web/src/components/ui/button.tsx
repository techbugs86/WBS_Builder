import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none',
  {
    variants: {
      variant: {
        default: [
          'text-white',
          'bg-gradient-to-b from-violet-500 to-violet-700',
          'border border-violet-600/50',
          'shadow-lg shadow-violet-900/30',
          'hover:from-violet-400 hover:to-violet-600',
          'active:from-violet-700 active:to-violet-800',
        ].join(' '),
        ghost: 'hover:bg-white/5',
        outline: [
          'border',
          'border-white/10',
          'hover:bg-white/5 hover:border-white/15',
        ].join(' '),
        destructive: 'bg-red-900/20 text-red-400 border border-red-900/40 hover:bg-red-900/35 hover:text-red-300',
        success: [
          'bg-emerald-900/20 text-emerald-400 border border-emerald-900/40',
          'hover:bg-emerald-900/35 hover:text-emerald-300',
        ].join(' '),
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 px-3 text-xs rounded-md',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const isGhost = variant === 'ghost' || variant === 'outline';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={isGhost ? { color: 'var(--text-secondary)', ...style } : style}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { buttonVariants };
