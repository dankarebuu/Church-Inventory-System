import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({
  className,
  containerClassName,
  containerLabel = 'Data table',
  ...props
}: React.ComponentProps<'table'> & {
  containerClassName?: string;
  containerLabel?: string;
}) {
  return (
    <div
      data-slot="table-container"
      tabIndex={0}
      role="region"
      aria-label={containerLabel}
      className={cn(
        'table-scroll-region relative w-full overflow-x-auto overscroll-x-contain rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        containerClassName
      )}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

export function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t border-border bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  scope = 'col',
  ...props
}: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn(
        'h-10 px-3 text-left align-middle font-sans text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('p-3 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
