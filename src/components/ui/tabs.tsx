import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    />
  );
}

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'table-scroll-region scrollbar-none inline-flex min-h-10 w-full max-w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto overscroll-x-contain rounded-lg border border-border bg-secondary p-1 text-muted-foreground snap-x snap-proximity sm:w-fit',
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex shrink-0 snap-start cursor-pointer touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:text-foreground enabled:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('tab-panel-animate flex-1 outline-none', className)}
      {...props}
    />
  );
}
