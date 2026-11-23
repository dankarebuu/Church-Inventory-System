import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground',
        className
      )}
      {...props}
    />
  );
}

export function CommandDialog({
  title = 'Command Palette',
  description = 'Search equipment, pages, and quick actions.',
  children,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className="overflow-hidden p-0 shadow-modal [&_[data-slot=command-input-wrapper]]:pr-11 [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:top-2.5"
        showCloseButton
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-4 [&_[cmdk-input]]:h-11 [&_[cmdk-item]]:px-2.5 [&_[cmdk-item]]:py-2">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  id = 'command-palette-search',
  name = 'command_search',
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-11 items-center gap-2 border-b border-border px-3"
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        id={id}
        name={name}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-slot="command-input"
        className={cn(
          'flex h-10 w-full rounded-md bg-transparent py-2 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm',
          className
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-[340px] scroll-py-1 overflow-y-auto overflow-x-hidden overscroll-contain', className)}
      {...props}
    />
  );
}

export function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>
) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-8 text-center text-sm text-muted-foreground"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn('overflow-hidden p-1.5 text-foreground', className)}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('ml-auto font-mono text-[11px] tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
}
