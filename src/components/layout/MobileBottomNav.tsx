import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeftRight,
  ClipboardCheck,
  FolderTree,
  LayoutDashboard,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { BRAND } from '@/lib/branding';
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
const SWIPE_UP_OPEN_THRESHOLD_PX = 24;

function BottomNavItem({ item }: { item: BottomNavLink }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'group flex min-h-[58px] min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-[color,transform] duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          isActive
            ? 'font-semibold text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'flex h-7 w-11 items-center justify-center rounded-full transition-[background-color,transform] duration-200 ease-out',
              isActive ? 'bg-primary/12' : 'group-hover:bg-accent/70'
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden="true" />
          </span>
          <span className="max-w-full truncate pb-px leading-tight">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * Sticky mobile-only bottom tab bar (`md:hidden no-print`) with a sculpted
 * curved center Steward dome trigger that opens or swipes up the Bottom Sheet
 * for both Guests and Staff.
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
  const leftLinks = links.slice(0, 2);
  const rightLinks = links.slice(2, 4);

  const isMenuHighlighted =
    isMoreOpen ||
    (isStaff && MORE_DRAWER_PATHS.some((path) => location.pathname.startsWith(path)));

  const swipeStartYRef = useRef<number | null>(null);
  const swipedOpenRef = useRef(false);

  const handleCenterPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    swipeStartYRef.current = event.clientY;
    swipedOpenRef.current = false;
  };

  const handleCenterPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (swipeStartYRef.current === null || swipedOpenRef.current) return;
    const deltaY = swipeStartYRef.current - event.clientY;
    if (deltaY >= SWIPE_UP_OPEN_THRESHOLD_PX) {
      swipedOpenRef.current = true;
      swipeStartYRef.current = null;
      onOpenMore?.();
    }
  };

  const handleCenterPointerEnd = () => {
    swipeStartYRef.current = null;
  };

  const handleCenterClick = () => {
    if (swipedOpenRef.current) {
      swipedOpenRef.current = false;
      return;
    }
    onOpenMore?.();
  };

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className={cn(
        'no-print sticky bottom-0 z-30 bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_18px_rgba(15,23,42,0.05)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.35)] md:hidden',
        className
      )}
    >
      {/* Seamless sculpted top border with smooth curved center dome */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[18px] inset-x-0 flex h-[18px] items-end"
      >
        <div className="h-px flex-1 bg-border" />
        <svg
          width="116"
          height="18"
          viewBox="0 0 116 18"
          fill="none"
          className="block shrink-0"
        >
          <path
            d="M 0 17.5 L 14 17.5 C 26 17.5, 29 1, 42 1 L 74 1 C 87 1, 90 17.5, 102 17.5 L 116 17.5 L 116 18 L 0 18 Z"
            fill="var(--color-card, #FFFFFF)"
          />
          <path
            d="M 0 17.5 L 14 17.5 C 26 17.5, 29 1, 42 1 L 74 1 C 87 1, 90 17.5, 102 17.5 L 116 17.5"
            stroke="var(--color-border, #E2E8F0)"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="relative grid grid-cols-5 items-stretch">
        {leftLinks.map((item) => (
          <BottomNavItem key={item.id} item={item} />
        ))}

        {/* Centered Steward logo curved notch trigger */}
        <button
          type="button"
          onClick={handleCenterClick}
          onPointerDown={handleCenterPointerDown}
          onPointerMove={handleCenterPointerMove}
          onPointerUp={handleCenterPointerEnd}
          onPointerCancel={handleCenterPointerEnd}
          aria-label="Open Steward menu"
          aria-expanded={isMoreOpen}
          aria-haspopup="dialog"
          className={cn(
            'group relative z-10 flex min-h-[58px] min-w-0 touch-pan-x cursor-pointer flex-col items-center justify-end gap-0.5 px-1 pb-1.5 pt-0 text-[11px] font-medium transition-[color,transform] duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            isMenuHighlighted
              ? 'font-semibold text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span
            className={cn(
              '-mt-3 flex size-9 items-center justify-center rounded-full p-0.5 transition-[transform,box-shadow] duration-200 ease-out group-hover:-translate-y-0.5',
              isMenuHighlighted
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-card'
                : 'ring-1 ring-border/70'
            )}
          >
            <img
              src="/images/logo.svg"
              alt=""
              aria-hidden="true"
              className="size-8 rounded-full"
            />
          </span>
          <span className="max-w-full truncate pb-px leading-tight">{BRAND.appName}</span>
        </button>

        {rightLinks.map((item) => (
          <BottomNavItem key={item.id} item={item} />
        ))}
      </div>
    </nav>
  );
}
