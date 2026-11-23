import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('skeleton-shimmer rounded-md', className)}
    />
  );
}

export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn('space-y-4', className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function PageShellSkeleton({
  label = 'Loading view...',
  cardCount = 4,
}: {
  label?: string;
  cardCount?: number;
}) {
  return (
    <SkeletonRegion label={label} className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28 rounded" />
          <Skeleton className="h-8 w-56 rounded-lg sm:w-64" />
          <Skeleton className="h-4 w-72 max-w-full rounded" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>

      <Skeleton className="h-14 w-full rounded-xl" />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: cardCount }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4 rounded" />
                <Skeleton className="h-3.5 w-1/2 rounded" />
              </div>
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
            <Skeleton className="h-9 w-full rounded-lg" />
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-3.5 w-28 rounded" />
              <Skeleton className="h-7 w-7 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function CardGridSkeleton({
  label,
  count = 6,
  columnsClass = 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3',
  withAccentBand = true,
  withTabsHeader = false,
}: {
  label: string;
  count?: number;
  columnsClass?: string;
  withAccentBand?: boolean;
  withTabsHeader?: boolean;
}) {
  return (
    <SkeletonRegion label={label}>
      {withTabsHeader && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card p-1">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-32 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      )}

      <div className={columnsClass}>
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className={cn(
              'relative space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-card',
              withAccentBand && 'pl-5'
            )}
          >
            {withAccentBand && (
              <div
                aria-hidden="true"
                className="skeleton-shimmer absolute inset-y-0 left-0 w-1.5"
              />
            )}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4 rounded" />
                  <Skeleton className="h-3 w-1/2 rounded" />
                </div>
              </div>
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="h-8 w-full rounded-lg" />
            <div className="flex items-center justify-between border-t border-dashed border-border pt-3">
              <Skeleton className="h-3.5 w-28 rounded" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-6 w-12 rounded" />
                <Skeleton className="size-7 rounded-md" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function TableRowsSkeleton({
  label,
  rows = 5,
  withTabsHeader = false,
  showAvatarCircle = false,
}: {
  label: string;
  rows?: number;
  withTabsHeader?: boolean;
  showAvatarCircle?: boolean;
}) {
  return (
    <SkeletonRegion label={label}>
      {withTabsHeader && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card p-1">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-7 w-28 rounded-md md:w-40" />
        </div>

        <div className="divide-y divide-border">
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Skeleton
                  className={cn(
                    'size-9 shrink-0',
                    showAvatarCircle ? 'rounded-full' : 'rounded-lg'
                  )}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-44 max-w-full rounded" />
                  <Skeleton className="h-3 w-28 max-w-full rounded" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:gap-4">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-7 w-16 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function FeedListSkeleton({
  label,
  rows = 4,
  compact = false,
}: {
  label: string;
  rows?: number;
  compact?: boolean;
}) {
  return (
    <SkeletonRegion label={label} className={compact ? 'space-y-2.5' : 'space-y-3'}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            'flex items-start gap-3 rounded-xl border border-border bg-card shadow-card',
            compact ? 'bg-background/60 p-3 shadow-none' : 'p-4'
          )}
        >
          <Skeleton
            className={cn(
              'shrink-0',
              compact ? 'size-7 rounded-full' : 'mt-0.5 size-9 rounded-lg'
            )}
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                {!compact && <Skeleton className="h-3.5 w-32 rounded" />}
              </div>
              <Skeleton className="h-3.5 w-24 rounded" />
            </div>
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-3.5 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

export function DashboardSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="space-y-6">
      {/* Hero Readiness Card + 4 Supporting Pills */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="space-y-2.5">
            <Skeleton className="h-3.5 w-28 rounded" />
            <div className="flex items-baseline gap-2.5">
              <Skeleton className="h-11 w-16 rounded-md" />
              <Skeleton className="h-5 w-28 rounded" />
            </div>
          </div>
          <div className="w-full max-w-sm space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-44 rounded" />
              <Skeleton className="h-4 w-12 rounded" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3.5 w-52 max-w-full rounded" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-1.5 bg-card p-3.5 sm:px-4">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-6 w-12 rounded-md" />
              <Skeleton className="h-3 w-24 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Low Stock Banner */}
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-card">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-3.5 w-64 max-w-full rounded" />
          </div>
        </div>
        <Skeleton className="hidden h-4 w-24 rounded sm:block" />
      </div>

      {/* Two-Chart Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-44 rounded" />
                <Skeleton className="h-3 w-32 rounded" />
              </div>
            </div>
            <Skeleton className="h-8 w-40 rounded-lg" />
          </div>
          <div className="space-y-2.5">
            {Array.from({ length: 4 }, (_, idx) => (
              <div key={idx} className="space-y-2 rounded-lg border border-border/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-36 rounded" />
                  <Skeleton className="h-4 w-20 rounded" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-5">
          <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-8 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-44 rounded" />
                  <Skeleton className="h-3 w-36 rounded" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
            <Skeleton className="h-[196px] w-full rounded-lg" />
          </div>

          <div className="flex-1 space-y-3 rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-8 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
            {Array.from({ length: 2 }, (_, idx) => (
              <Skeleton key={idx} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function ChecklistSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="space-y-5">
      <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-4 w-52 max-w-full rounded" />
            <Skeleton className="h-3 w-36 rounded" />
          </div>
          <Skeleton className="h-8 w-14 rounded-md" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>

      <Skeleton className="h-14 w-full rounded-xl" />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border border-border bg-card p-4 pl-5 shadow-card"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-40 rounded" />
                <Skeleton className="h-3 w-28 rounded" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="h-8 w-full rounded-lg" />
            <div className="grid grid-cols-3 gap-2 pt-1">
              <Skeleton className="h-11 rounded-md" />
              <Skeleton className="h-11 rounded-md" />
              <Skeleton className="h-11 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function FormCardSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-24 rounded" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-32 rounded" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
    </SkeletonRegion>
  );
}
