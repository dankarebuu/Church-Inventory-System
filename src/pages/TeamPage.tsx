import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/features/auth/useAuth';
import {
  canDemoteProfile,
  getProfileDisplayName,
  useTeamRoles,
} from '@/features/team/useTeamRoles';
import { formatDisplayDate, getInitials } from '@/lib/utils';
import type { ProfileRecord } from '@/types/database';

const ALL_ROLES = '__all__';

/**
 * Admin-only Team Roles management route (`member` <-> `admin`) with UI and
 * client-side last-admin protection plus guidance on Supabase Auth invitations.
 */
export function TeamPage() {
  const { user } = useAuth();
  const {
    profiles,
    adminCount,
    isLoading,
    isError,
    error,
    refetch,
    updateUserRole,
    isUpdating,
  } = useTeamRoles();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>(ALL_ROLES);
  const [updatingProfileId, setUpdatingProfileId] = useState<string | null>(null);
  const [pendingSelfDemotion, setPendingSelfDemotion] =
    useState<ProfileRecord | null>(null);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const filteredProfiles = useMemo(() => {
    return profiles.filter((profile) => {
      if (roleFilter !== ALL_ROLES && profile.role !== roleFilter) {
        return false;
      }

      if (normalizedSearch) {
        const displayName = getProfileDisplayName(profile);
        const haystack = [displayName, profile.email, profile.role]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }

      return true;
    });
  }, [normalizedSearch, profiles, roleFilter]);

  const memberCount = profiles.length - adminCount;
  const hasActiveFilters = Boolean(normalizedSearch) || roleFilter !== ALL_ROLES;

  const applyRoleUpdate = async (
    targetProfile: ProfileRecord,
    targetRole: 'member' | 'admin'
  ) => {
    setUpdatingProfileId(targetProfile.id);
    const displayName = getProfileDisplayName(targetProfile);
    try {
      await updateUserRole({
        profileId: targetProfile.id,
        targetRole,
      });
      toast.success(
        `Updated ${displayName} to ${targetRole === 'admin' ? 'Admin' : 'Band Member'}.`
      );
      setPendingSelfDemotion(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to update team member role.';
      toast.error(message);
    } finally {
      setUpdatingProfileId(null);
    }
  };

  const handleToggleRole = (targetProfile: ProfileRecord) => {
    const nextRole: 'member' | 'admin' =
      targetProfile.role === 'admin' ? 'member' : 'admin';

    if (nextRole === 'member' && !canDemoteProfile(profiles, targetProfile.id)) {
      toast.error(
        'Cannot demote the last remaining admin. Promote another team member to Admin first.'
      );
      return;
    }

    if (nextRole === 'member' && user?.id === targetProfile.id) {
      setPendingSelfDemotion(targetProfile);
      return;
    }

    void applyRoleUpdate(targetProfile, nextRole);
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            Admin Only
          </span>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Team Roles
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage Band Member and Admin access permissions across signed-up team profiles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default" className="gap-1.5">
            <ShieldCheck className="size-3" aria-hidden="true" />
            <span>
              {adminCount} {adminCount === 1 ? 'Admin' : 'Admins'}
            </span>
          </Badge>
          <Badge variant="secondary" className="gap-1.5">
            <UserCheck className="size-3" aria-hidden="true" />
            <span>
              {memberCount} {memberCount === 1 ? 'Band Member' : 'Band Members'}
            </span>
          </Badge>
        </div>
      </div>

      {/* Supabase Auth Invitation Guidance */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/8 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">
            User Invitations &amp; Account Lifecycle
          </p>
          <p>
            New user invitations, email confirmations, and account removals remain managed in the{' '}
            <span className="font-semibold text-foreground">Supabase Auth Dashboard</span>. New
            accounts automatically receive <span className="font-mono font-semibold">Band Member</span>{' '}
            access and can be promoted or demoted here.
          </p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search team members by name or email..."
            aria-label="Search team profiles"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger aria-label="Filter by role" className="w-full sm:w-[180px]">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ROLES}>All Roles</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
              <SelectItem value="member">Band Members</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearchQuery('');
                setRoleFilter(ALL_ROLES);
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
              <span>Clear Filters</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div
          role="status"
          className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-8 text-muted-foreground shadow-card"
        >
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-wider">
            Loading team profiles...
          </span>
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-6 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">Unable to load team profiles</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {error?.message ?? 'An unexpected error occurred while reading profiles.'}
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
          <Users className="size-10 text-muted-foreground/60" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {hasActiveFilters
                ? 'No team profiles match your search'
                : 'No team profiles found'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {hasActiveFilters
                ? 'Try clearing your search or switching the role filter.'
                : 'Invite band team members through the Supabase Auth Dashboard.'}
            </p>
          </div>
          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearchQuery('');
                setRoleFilter(ALL_ROLES);
              }}
            >
              Clear Filters
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Team Member</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Access Control</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProfiles.map((profile) => {
                const displayName = getProfileDisplayName(profile);
                const initials = getInitials(displayName);
                const isSelf = user?.id === profile.id;
                const isAdminProfile = profile.role === 'admin';
                const isLastAdmin = isAdminProfile && adminCount <= 1;
                const isRowUpdating = updatingProfileId === profile.id;

                return (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <div className="flex min-w-[180px] items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary"
                        >
                          {initials}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-foreground">
                            {displayName}
                          </span>
                          {isSelf && <Badge variant="outline">You</Badge>}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {profile.email}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={isAdminProfile ? 'default' : 'secondary'}
                        className="gap-1"
                      >
                        {isAdminProfile ? (
                          <ShieldCheck className="size-3" aria-hidden="true" />
                        ) : (
                          <UserCheck className="size-3" aria-hidden="true" />
                        )}
                        <span>{isAdminProfile ? 'Admin' : 'Band Member'}</span>
                      </Badge>
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDisplayDate(profile.created_at)}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isLastAdmin || isRowUpdating || isUpdating}
                          onClick={() => handleToggleRole(profile)}
                        >
                          {isRowUpdating ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : isAdminProfile ? (
                            <UserCheck className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Shield className="size-3.5" aria-hidden="true" />
                          )}
                          <span>
                            {isRowUpdating
                              ? 'Updating...'
                              : isAdminProfile
                                ? 'Demote to Member'
                                : 'Promote to Admin'}
                          </span>
                        </Button>

                        {isLastAdmin && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            Last admin cannot be demoted
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Self-Demotion Confirmation (only reachable when another Admin exists) */}
      <AlertDialog
        open={Boolean(pendingSelfDemotion)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isUpdating) {
            setPendingSelfDemotion(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Step down to Band Member?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to demote your own account to{' '}
              <span className="font-semibold text-foreground">Band Member</span>. You will
              immediately lose access to Admin CRUD controls, Import/Export, Activity Undo/Restore,
              and Team Roles until another Admin promotes you again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isUpdating}
              onClick={(event) => {
                event.preventDefault();
                if (pendingSelfDemotion) {
                  void applyRoleUpdate(pendingSelfDemotion, 'member');
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isUpdating ? 'Updating...' : 'Confirm Self-Demotion'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
