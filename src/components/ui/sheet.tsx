import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

export function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/55 backdrop-blur-xs data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
        className
      )}
      {...props}
    />
  );
}

const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-4 bg-card text-card-foreground shadow-modal focus:outline-none',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b border-border data-[state=open]:animate-sheet-in-top data-[state=closed]:animate-sheet-out-top',
        bottom:
          'inset-x-0 bottom-0 max-h-[85dvh] overflow-hidden rounded-t-2xl border-t border-border overscroll-contain data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom',
        left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm border-r border-border data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left',
        right:
          'inset-y-0 right-0 h-full w-full max-w-xl border-l border-border data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right',
      },
    },
    defaultVariants: {
      side: 'right',
    },
  }
);

export function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> &
  VariantProps<typeof sheetVariants> & {
    showCloseButton?: boolean;
  }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground opacity-80 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-6 pb-2', className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-6 pt-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-display text-lg font-semibold text-foreground', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
