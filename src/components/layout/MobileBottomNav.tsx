import {
  ArrowLeftRight,
  ClipboardCheck,
  FolderTree,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/database';

export interface MobileBottomNavProps {
  role: UserRole;
  onOpenMore?: () => void;
  isMoreOpen?: boolean;
  className?: string;
}

interface BottomNavLink {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
}

const GUEST_BOTTOM_LINKS: readonly BottomNavLink[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', to: '/inventory', icon: Package },
  { id: 'checklist', label: 'Checklist', to: '/checklist', icon: ClipboardCheck },
  { id: 'categories', label: 'Categories', to: '/categories', icon: FolderTree },
];

const STAFF_BOTTOM_LINKS: readonly BottomNavLink[] = [
  { id: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventory', to: '/inventory', icon: Package },
  { id: 'checklist', label: 'Checklist', to: '/checklist', icon: ClipboardCheck },
  { id: 'loans', label: 'Loans', to: '/loans', icon: ArrowLeftRight },
];

const MORE_DRAWER_PATHS = ['/categories', '/activity', '/team'] as const;

/**
 * Sticky mobile-only bottom tab bar (`md:hidden no-print`) optimized for Sunday
 * one-handed navigation with safe-area bottom inset padding.
 */
export function MobileBottomNav({
  role,
  onOpenMore,
  isMoreOpen = false,
  className,
}: MobileBottomNavProps) {
  const location = useLocation();
  const isStaff = role === 'member' || role === 'admin';
  const links = isStaff ? STAFF_BOTTOM_LINKS : GUEST_BOTTOM_LINKS;
  const isMoreRouteActive =
    isStaff &&
    (isMoreOpen || MORE_DRAWER_PATHS.some((path) => location.pathname.startsWith(path)));

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className={cn(
        'no-print sticky bottom-0 z-30 border-t border-border bg-topbar backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]',
        className
      )}
    >
      <div className={cn('grid items-stretch', isStaff ? 'grid-cols-5' : 'grid-cols-4')}>
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  isActive
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="max-w-full truncate leading-none">{item.label}</span>
            </NavLink>
          );
        })}

        {isStaff && (
          <button
            type="button"
            onClick={onOpenMore}
            aria-expanded={isMoreOpen}
            aria-haspopup="dialog"
            className={cn(
              'flex min-h-[56px] min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              isMoreRouteActive
                ? 'text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MoreHorizontal className="size-5 shrink-0" aria-hidden="true" />
            <span className="max-w-full truncate leading-none">More</span>
          </button>
        )}
      </div>
    </nav>
  );
}
