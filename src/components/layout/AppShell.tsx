import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FolderTree,
  History,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sun,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AccountSettingsDialog } from '@/features/auth/AccountSettingsDialog';
import { useAuth } from '@/features/auth/useAuth';
import { useOfflineCatalogSync } from '@/hooks/useOfflineCatalogSync';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useRealtimeSync, type RealtimeSyncStatus } from '@/hooks/useRealtimeSync';
import {
  getOfflineSnapshotSavedAt,
  OFFLINE_CACHE_UPDATED_EVENT,
} from '@/lib/offlineCache';
import { queryKeys } from '@/lib/queryKeys';
import { cn, getInitials, getUserEmailPrefix } from '@/lib/utils';
import type { ItemCondition, ProfileRecord, UserRole } from '@/types/database';
import { MobileBottomNav } from './MobileBottomNav';
import { OfflineBanner } from './OfflineBanner';

export interface AppNavItem {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  allowedRoles: readonly UserRole[];
  description: string;
}

export const APP_NAV_ITEMS: readonly AppNavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    allowedRoles: ['guest', 'member', 'admin'],
    description: 'KPIs, flagged equipment, and category breakdown',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    to: '/inventory',
    icon: Package,
    allowedRoles: ['guest', 'member', 'admin'],
    description: 'Browse, filter, inspect, and manage band gear',
  },
  {
    id: 'categories',
    label: 'Categories & Locations',
    to: '/categories',
    icon: FolderTree,
    allowedRoles: ['guest', 'member', 'admin'],
    description: 'Organize equipment categories and storage rooms',
  },
  {
    id: 'checklist',
    label: 'Sunday Checklist',
    to: '/checklist',
    icon: ClipboardCheck,
    allowedRoles: ['guest', 'member', 'admin'],
    description: 'Live Sunday check-off and printable checklist sheet',
  },
  {
    id: 'loans',
    label: 'Loans & Check-Out',
    to: '/loans',
    icon: ArrowLeftRight,
    allowedRoles: ['member', 'admin'],
    description: 'Track active check-outs, due dates, and returns',
  },
  {
    id: 'activity',
    label: 'Activity Log',
    to: '/activity',
    icon: History,
    allowedRoles: ['member', 'admin'],
    description: 'Audit trail, undo actions, and item restoration',
  },
  {
    id: 'team',
    label: 'Team Roles',
    to: '/team',
    icon: Shield,
    allowedRoles: ['admin'],
    description: 'Manage Band Member and Admin access permissions',
  },
];

interface SearchableInventoryItem {
  id: string;
  item: string;
  category: string;
  brand?: string | null;
  location?: string | null;
  serial?: string | null;
  condition?: ItemCondition;
  deleted_at?: string | null;
}

const ROLE_LABELS: Record<UserRole, string> = {
  guest: 'Guest (View Only)',
  member: 'Band Member',
  admin: 'Admin',
};

const SYNC_DOT_CLASSES: Record<RealtimeSyncStatus['status'], string> = {
  connected: 'bg-success',
  connecting: 'bg-primary animate-pulse',
  error: 'bg-destructive',
  offline: 'bg-muted-foreground',
  idle: 'bg-muted-foreground',
};

function isItemCondition(value: unknown): value is ItemCondition {
  return value === 'working' || value === 'repair' || value === 'missing';
}

function isSearchableInventoryItem(value: unknown): value is SearchableInventoryItem {
  if (typeof value !== 'object' || value === null) return false;
  if (!('id' in value) || typeof value.id !== 'string') return false;
  if (!('item' in value) || typeof value.item !== 'string') return false;
  if (!('category' in value) || typeof value.category !== 'string') return false;
  if ('deleted_at' in value && typeof value.deleted_at === 'string' && value.deleted_at.length > 0) {
    return false;
  }
  return true;
}

function readCachedInventoryItems(
  queryClient: QueryClient,
  role: UserRole
): SearchableInventoryItem[] {
  const cached = queryClient.getQueryData<unknown>(queryKeys.inventory(role));
  if (!Array.isArray(cached)) return [];
  return cached.filter(isSearchableInventoryItem);
}

function deriveUserDisplay(
  profile: ProfileRecord | null,
  user: User | null
): { displayName: string; email: string; initials: string } {
  const profileName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  const meta = user?.user_metadata ?? {};
  const metaFirst = typeof meta.first_name === 'string' ? meta.first_name.trim() : '';
  const metaLast = typeof meta.last_name === 'string' ? meta.last_name.trim() : '';
  const metaCombined = [metaFirst, metaLast].filter(Boolean).join(' ').trim();
  const metaFull =
    typeof meta.full_name === 'string' && meta.full_name.trim()
      ? meta.full_name.trim()
      : metaCombined;

  const email = profile?.email ?? user?.email ?? '';
  const displayName = profileName || metaFull || getUserEmailPrefix(email);
  const initials = getInitials(displayName || email);

  return { displayName, email, initials };
}

function getShortcutLabel(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.platform || navigator.userAgent;
    if (/Mac|iPhone|iPad|iPod/i.test(ua)) {
      return '⌘K';
    }
  }
  return 'Ctrl+K';
}

function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3',
        collapsed ? 'justify-center px-2 py-1' : 'px-1 py-1'
      )}
    >
      <img
        src="/images/logo.svg"
        alt="WINGMACC logo"
        className="size-10 shrink-0 rounded-xl border border-border/60 bg-background p-1"
      />
      {!collapsed && (
        <div className="min-w-0">
          <span className="tape inline-block rounded bg-primary px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
            CHURCH PROPERTY INVENTORY LOG
          </span>
          <p className="font-display mt-1 truncate text-base font-bold leading-tight text-foreground">
            Band Inventory
          </p>
        </div>
      )}
    </div>
  );
}

function SidebarNav({
  items,
  collapsed = false,
  onNavigate,
}: {
  items: readonly AppNavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Workspace navigation" className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.id}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-[background-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                collapsed && 'justify-center px-2',
                isActive
                  ? 'bg-primary/12 text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

function RoleSummaryPill({ role, collapsed = false }: { role: UserRole; collapsed?: boolean }) {
  const Icon = role === 'admin' ? ShieldCheck : role === 'member' ? UserCheck : Eye;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-2.5 py-2 text-xs text-muted-foreground',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? ROLE_LABELS[role] : undefined}
    >
      <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      {!collapsed && (
        <span className="truncate font-mono text-[11px] font-medium text-foreground">
          {ROLE_LABELS[role]}
        </span>
      )}
    </div>
  );
}

function getSyncTooltip(syncStatus: RealtimeSyncStatus, role: UserRole): string {
  if (syncStatus.status === 'offline') {
    return role === 'guest'
      ? 'Offline — catalog sync paused'
      : 'Offline — realtime sync paused';
  }
  if (syncStatus.status === 'error') {
    return 'Realtime connection issue — data refreshes on navigation';
  }
  if (syncStatus.status === 'connecting') {
    return role === 'guest'
      ? 'Connecting to live category & location updates...'
      : 'Connecting to live Realtime sync...';
  }
  if (role === 'guest') {
    return 'Categories & locations sync live; inventory availability refreshes on tab focus and every 60s.';
  }
  return 'Connected to live Realtime updates across inventory, loans, and activity.';
}

function RealtimeStatusPill({
  syncStatus,
  role,
}: {
  syncStatus: RealtimeSyncStatus;
  role: UserRole;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Realtime sync: ${syncStatus.label}`}
      title={getSyncTooltip(syncStatus, role)}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] font-medium text-sync-text shadow-xs"
    >
      <span
        className={cn('size-2 rounded-full', SYNC_DOT_CLASSES[syncStatus.status])}
        aria-hidden="true"
      />
      <span className="hidden sm:inline">{syncStatus.label}</span>
    </div>
  );
}

function UserAccountMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { user, profile, role, openAuthModal, signOut } = useAuth();

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="hidden gap-1 sm:inline-flex">
          <Eye className="size-3" aria-hidden="true" />
          <span>View Only</span>
        </Badge>
        <Button type="button" size="sm" onClick={() => openAuthModal('login')}>
          <LogIn className="size-3.5" aria-hidden="true" />
          <span>Login</span>
        </Button>
      </div>
    );
  }

  const { displayName, email, initials } = deriveUserDisplay(profile, user);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-9 gap-2 rounded-full px-2 sm:rounded-lg"
          aria-label="Account menu"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary">
            {initials}
          </span>
          <span className="hidden max-w-[140px] truncate text-sm font-medium text-foreground sm:inline">
            {displayName}
          </span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground sm:inline" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-sans text-xs font-normal normal-case tracking-normal">
          <div className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
            {email && <span className="truncate text-xs text-muted-foreground">{email}</span>}
            <span className="mt-1 inline-flex w-fit rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
              {ROLE_LABELS[role]}
            </span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings className="size-4" aria-hidden="true" />
          <span>Account Settings</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden="true" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Responsive application shell with role-filtered sidebar navigation, mobile
 * drawer, Cmd/Ctrl+K quick search, Realtime status pill, theme toggle, and
 * account menu.
 */
export function AppShell({ children }: { children?: ReactNode }) {
  const {
    role,
    isLoading: isAuthLoading,
    theme,
    toggleTheme,
    user,
    showGateway,
    isAuthModalOpen,
  } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOnline, isOffline } = useOnlineStatus();
  const cacheUserId = role === 'guest' ? null : (user?.id ?? null);
  useOfflineCatalogSync({
    userId: user?.id ?? null,
    role,
    isAuthLoading,
    isOnline,
  });
  const syncStatus = useRealtimeSync(role);

  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() =>
    getOfflineSnapshotSavedAt(cacheUserId)
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const visibleNavItems = APP_NAV_ITEMS.filter((item) => item.allowedRoles.includes(role));
  const cachedInventoryItems = commandOpen ? readCachedInventoryItems(queryClient, role) : [];
  const shortcutLabel = getShortcutLabel();

  useEffect(() => {
    setLastSyncedAt(getOfflineSnapshotSavedAt(cacheUserId));
    if (typeof window === 'undefined') return;

    const handleCacheUpdated = () => {
      setLastSyncedAt(getOfflineSnapshotSavedAt(cacheUserId));
    };

    window.addEventListener(OFFLINE_CACHE_UPDATED_EVENT, handleCacheUpdated);
    return () => window.removeEventListener(OFFLINE_CACHE_UPDATED_EVENT, handleCacheUpdated);
  }, [cacheUserId, isOffline]);

  useEffect(() => {
    if (!user) {
      setSettingsOpen(false);
    }
  }, [user]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (showGateway || isAuthModalOpen || settingsOpen) return;
        event.preventDefault();
        setMobileNavOpen(false);
        setCommandOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showGateway, isAuthModalOpen, settingsOpen]);

  const handleSelectRoute = (to: string) => {
    setCommandOpen(false);
    navigate(to);
  };

  const handleSelectInventoryItem = (itemId: string) => {
    setCommandOpen(false);
    navigate(`/inventory?item=${encodeURIComponent(itemId)}`);
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="no-print sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-modal focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      {/* Desktop Collapsible Sidebar */}
      <aside
        aria-label="Primary sidebar"
        className={cn(
          'no-print hidden shrink-0 flex-col border-r border-border bg-card transition-[width,background-color,border-color] duration-200 md:sticky md:top-0 md:flex md:h-screen',
          sidebarCollapsed ? 'md:w-[74px]' : 'md:w-64'
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-4">
          <SidebarBrand collapsed={sidebarCollapsed} />
          {!sidebarCollapsed && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse sidebar"
              aria-expanded={true}
              className="size-8 shrink-0 text-muted-foreground"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        {sidebarCollapsed && (
          <div className="flex justify-center border-b border-border py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              aria-expanded={false}
              className="size-8 text-muted-foreground"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2.5 py-4">
          <SidebarNav items={visibleNavItems} collapsed={sidebarCollapsed} />
        </div>

        <div className="border-t border-border p-3">
          <RoleSummaryPill role={role} collapsed={sidebarCollapsed} />
        </div>
      </aside>

      {/* Mobile Drawer Navigation */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="no-print flex w-72 flex-col gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription>Navigate WINGMACC Band Inventory pages</SheetDescription>
          </SheetHeader>

          <div className="border-b border-border px-4 py-4 pr-12">
            <SidebarBrand />
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarNav
              items={visibleNavItems}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>

          <div className="border-t border-border p-3">
            <RoleSummaryPill role={role} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-topbar px-4 backdrop-blur-md transition-[background-color,border-color] duration-200 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => setCommandOpen(true)}
              aria-label="Open quick search"
              className="h-9 w-full max-w-xs justify-between gap-2 border-input bg-background/80 px-3 text-muted-foreground hover:bg-accent hover:text-foreground sm:w-64 md:w-72"
            >
              <span className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
                <Search className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Search gear or pages...</span>
              </span>
              <kbd className="hidden shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
                {shortcutLabel}
              </kbd>
            </Button>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            <RealtimeStatusPill syncStatus={syncStatus} role={role} />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="relative overflow-hidden"
            >
              <Sun
                className={cn(
                  'size-4 transition-[transform,opacity] duration-200 ease-out',
                  theme === 'dark'
                    ? 'rotate-0 scale-100 opacity-100'
                    : '-rotate-90 scale-75 opacity-0'
                )}
                aria-hidden="true"
              />
              <Moon
                className={cn(
                  'absolute size-4 transition-[transform,opacity] duration-200 ease-out',
                  theme === 'dark'
                    ? 'rotate-90 scale-75 opacity-0'
                    : 'rotate-0 scale-100 opacity-100'
                )}
                aria-hidden="true"
              />
            </Button>

            <UserAccountMenu onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        </header>

        <OfflineBanner isOffline={isOffline} lastSyncedAt={lastSyncedAt} />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 pt-6 pb-24 focus:outline-none sm:px-6 md:pb-6 lg:px-8"
        >
          {children !== undefined ? children : <Outlet />}
        </main>

        <MobileBottomNav
          role={role}
          onOpenMore={() => setMobileNavOpen(true)}
          isMoreOpen={mobileNavOpen}
        />
      </div>

      {/* Cmd/Ctrl+K Command Palette */}
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Search band equipment or jump to a page..." />
        <CommandList>
          <CommandEmpty>No matching pages or cached gear found.</CommandEmpty>

          <CommandGroup heading="Pages">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.description} ${item.to}`}
                  onSelect={() => handleSelectRoute(item.to)}
                >
                  <Icon className="text-muted-foreground" aria-hidden="true" />
                  <span>{item.label}</span>
                  <CommandShortcut>{item.to}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>

          {cachedInventoryItems.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Cached Inventory Gear">
                {cachedInventoryItems.map((item) => {
                  const subtitle = [item.category, item.brand, item.location]
                    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
                    .join(' · ');

                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item.item} ${item.brand ?? ''} ${item.category} ${item.location ?? ''} ${item.serial ?? ''} ${item.id}`}
                      onSelect={() => handleSelectInventoryItem(item.id)}
                    >
                      <Package className="text-primary" aria-hidden="true" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">{item.item}</span>
                        {subtitle && (
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {subtitle}
                          </span>
                        )}
                      </div>
                      {isItemCondition(item.condition) && (
                        <Badge variant={item.condition} className="ml-2 shrink-0">
                          {item.condition}
                        </Badge>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {user && (
        <AccountSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          isOffline={isOffline}
        />
      )}
    </div>
  );
}
