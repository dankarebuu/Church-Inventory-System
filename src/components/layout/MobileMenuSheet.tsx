import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { ChevronRight, Eye, LogIn, LogOut, Settings, X } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { RealtimeSyncStatus } from '@/hooks/useRealtimeSync';
import { BRAND } from '@/lib/branding';
import { cn } from '@/lib/utils';
import type { ProfileRecord, UserRole } from '@/types/database';
import {
  deriveUserDisplay,
  ROLE_LABELS,
  SYNC_DOT_CLASSES,
  type AppNavItem,
} from './navConfig';

const SWIPE_DISMISS_THRESHOLD_PX = 72;
const SWIPE_DISMISS_VELOCITY_PX_PER_MS = 0.45;

export interface MobileMenuSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly AppNavItem[];
  role: UserRole;
  user: User | null;
  profile: ProfileRecord | null;
  syncStatus: RealtimeSyncStatus;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onSignOut: () => void;
}

/**
 * Native-feeling Android/iOS bottom sheet replacing the tall mobile left drawer.
 * Fits its height cleanly around an upfront Account & Sync card, compact nav rows,
 * and a swipe-down-to-dismiss handle.
 */
export function MobileMenuSheet({
  open,
  onOpenChange,
  items,
  role,
  user,
  profile,
  syncStatus,
  onOpenSettings,
  onOpenLogin,
  onSignOut,
}: MobileMenuSheetProps) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ pointerId: number; startY: number; startTime: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setIsDragging(false);
      dragStartRef.current = null;
    }
  }, [open]);

  const closeSheet = () => {
    onOpenChange(false);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, a')) return;

    dragStartRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: performance.now(),
    };
    setIsDragging(true);
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore browsers that reject synthetic pointer capture.
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaY = Math.max(0, event.clientY - start.startY);
    setDragY(deltaY);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    const deltaY = Math.max(0, event.clientY - start.startY);
    const elapsedMs = Math.max(1, performance.now() - start.startTime);
    const velocity = deltaY / elapsedMs;

    dragStartRef.current = null;
    setIsDragging(false);

    if (deltaY > SWIPE_DISMISS_THRESHOLD_PX || (deltaY > 24 && velocity > SWIPE_DISMISS_VELOCITY_PX_PER_MS)) {
      setDragY(0);
      closeSheet();
      return;
    }

    setDragY(0);
  };

  const { displayName, email, initials } = deriveUserDisplay(profile, user);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        style={
          dragY > 0 || isDragging
            ? {
                transform: `translateY(${dragY}px)`,
                transition: isDragging ? 'none' : 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
              }
            : undefined
        }
        className="no-print gap-0 p-0 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation Menu</SheetTitle>
          <SheetDescription>Navigate {BRAND.fullTitle} pages and account controls</SheetDescription>
        </SheetHeader>

        {/* Swipe-down handle & compact brand header */}
        <div
          data-testid="mobile-sheet-drag-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          className="touch-none select-none border-b border-border px-4 pb-3 pt-2.5"
        >
          <div className="mb-2.5 flex justify-center" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Link
              to="/dashboard"
              onClick={closeSheet}
              className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src="/images/logo.svg"
                alt={BRAND.logoAlt}
                className="size-8 shrink-0 rounded-full"
              />
              <div className="min-w-0">
                <p className="font-display truncate text-base font-bold leading-tight tracking-tight text-foreground">
                  {BRAND.appName}
                </p>
                <p className="truncate font-sans text-[11px] font-medium leading-tight text-muted-foreground">
                  {BRAND.workspaceLabel}
                </p>
              </div>
            </Link>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeSheet}
              aria-label="Close navigation menu"
              className="size-10 shrink-0 rounded-full text-muted-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {/* Upfront Account & Sync Card */}
        <div className="px-4 pt-3">
          <div
            data-testid="mobile-sheet-account-card"
            className="rounded-xl border border-border bg-secondary/50 p-3"
          >
            {user ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-sm font-bold text-primary">
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-display text-sm font-semibold text-foreground">
                        {displayName}
                      </p>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        {ROLE_LABELS[role]}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {email && <span className="truncate">{email}</span>}
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-sync-text">
                        <span
                          className={cn('size-1.5 rounded-full', SYNC_DOT_CLASSES[syncStatus.status])}
                          aria-hidden="true"
                        />
                        {syncStatus.label}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center gap-2 border-t border-border/80 pt-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      closeSheet();
                      onOpenSettings();
                    }}
                    className="h-9 flex-1 bg-card"
                  >
                    <Settings className="size-3.5" aria-hidden="true" />
                    <span>Account Settings</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      closeSheet();
                      onSignOut();
                    }}
                    className="h-9 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <LogOut className="size-3.5" aria-hidden="true" />
                    <span>Sign Out</span>
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-primary">
                    <Eye className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-foreground">
                      {ROLE_LABELS[role]}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={cn('size-1.5 rounded-full', SYNC_DOT_CLASSES[syncStatus.status])}
                        aria-hidden="true"
                      />
                      <span>{syncStatus.label}</span>
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    closeSheet();
                    onOpenLogin();
                  }}
                  className="h-9 shrink-0"
                >
                  <LogIn className="size-3.5" aria-hidden="true" />
                  <span>Login</span>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable compact navigation list */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-1">
          <nav aria-label="Mobile navigation menu" className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.id}
                  to={item.to}
                  onClick={closeSheet}
                  className={({ isActive }) =>
                    cn(
                      'group flex min-h-[46px] touch-manipulation items-center gap-3 rounded-xl px-3 py-2 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'bg-primary/12 text-primary'
                        : 'text-foreground hover:bg-accent/70'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                          isActive
                            ? 'bg-primary/15 text-primary'
                            : 'bg-secondary/70 text-muted-foreground group-hover:text-foreground'
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'truncate font-sans text-sm leading-tight',
                            isActive ? 'font-semibold text-primary' : 'font-medium text-foreground'
                          )}
                        >
                          {item.label}
                        </p>
                        <p className="truncate font-sans text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                      <ChevronRight
                        className={cn(
                          'size-4 shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5',
                          isActive ? 'text-primary' : 'text-muted-foreground/60'
                        )}
                        aria-hidden="true"
                      />
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );
}
