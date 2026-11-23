import type { User } from '@supabase/supabase-js';
import {
  ArrowLeftRight,
  ClipboardCheck,
  FolderTree,
  History,
  LayoutDashboard,
  Package,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import type { RealtimeSyncStatus } from '@/hooks/useRealtimeSync';
import { getInitials, getUserEmailPrefix } from '@/lib/utils';
import type { ProfileRecord, UserRole } from '@/types/database';

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
    description: 'Browse, filter, inspect, and manage equipment',
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

export const ROLE_LABELS: Record<UserRole, string> = {
  guest: 'Guest (View Only)',
  member: 'Band Member',
  admin: 'Admin',
};

export const SYNC_DOT_CLASSES: Record<RealtimeSyncStatus['status'], string> = {
  connected: 'bg-success',
  connecting: 'bg-primary animate-pulse',
  error: 'bg-destructive',
  offline: 'bg-muted-foreground',
  idle: 'bg-muted-foreground',
};

export function deriveUserDisplay(
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

export function getSyncTooltip(syncStatus: RealtimeSyncStatus, role: UserRole): string {
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
