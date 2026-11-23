import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-ring',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary-fill text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive-fill text-destructive-foreground',
        outline: 'border-border text-foreground',
        working:
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
        repair:
          'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300',
        missing:
          'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300',
        loaned:
          'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300',
        lowStock:
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
