import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex touch-manipulation items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[transform,scale,background-color,border-color,color,box-shadow] duration-150 ease-out enabled:active:scale-[0.97] cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      variant: {
        default: 'bg-primary-fill text-primary-foreground shadow-xs hover:bg-amber-hover',
        destructive: 'bg-destructive-fill text-destructive-foreground shadow-xs hover:opacity-90',
        outline:
          'border border-input bg-card text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:opacity-85',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-lg px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
