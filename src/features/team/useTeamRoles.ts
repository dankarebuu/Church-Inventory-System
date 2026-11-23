import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getUserEmailPrefix } from '@/lib/utils';
import type { ProfileRecord } from '@/types/database';

const EMPTY_PROFILES: ProfileRecord[] = [];

export interface UpdateUserRoleInput {
  profileId: string;
  targetRole: 'member' | 'admin';
}

export function getProfileDisplayName(profile: ProfileRecord): string {
  const fullName = [profile.first_name, profile.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  return fullName || getUserEmailPrefix(profile.email);
}

export function countAdmins(profiles: readonly ProfileRecord[]): number {
  return profiles.reduce(
    (count, profile) => (profile.role === 'admin' ? count + 1 : count),
    0
  );
}

export function canDemoteProfile(
  profiles: readonly ProfileRecord[],
  profileId: string
): boolean {
  const target = profiles.find((profile) => profile.id === profileId);
  if (!target || target.role !== 'admin') return true;
  return countAdmins(profiles) > 1;
}

function sortTeamProfiles(profiles: readonly ProfileRecord[]): ProfileRecord[] {
  return [...profiles].sort((a, b) => {
    if (a.role !== b.role) {
      return a.role === 'admin' ? -1 : 1;
    }
    const nameCmp = getProfileDisplayName(a).localeCompare(getProfileDisplayName(b));
    if (nameCmp !== 0) return nameCmp;
    return a.email.localeCompare(b.email);
  });
}

async function fetchProfiles(): Promise<ProfileRecord[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return sortTeamProfiles(data ?? []);
}

/**
 * Admin-only hook for viewing `public.profiles` and updating `member`/`admin`
 * roles with client-side last-admin protection and immediate self-profile sync.
 */
export function useTeamRoles() {
  const { role, user, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const canManageTeam = isSupabaseConfigured && role === 'admin';

  const query = useQuery<ProfileRecord[], Error>({
    queryKey: queryKeys.profiles,
    queryFn: fetchProfiles,
    enabled: canManageTeam,
  });

  const profiles = canManageTeam ? (query.data ?? EMPTY_PROFILES) : EMPTY_PROFILES;
  const adminCount = useMemo(() => countAdmins(profiles), [profiles]);

  const updateRoleMutation = useMutation<ProfileRecord, Error, UpdateUserRoleInput>({
    mutationFn: async ({ profileId, targetRole }) => {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured.');
      }
      if (role !== 'admin') {
        throw new Error('Only administrators can update team roles.');
      }

      const cachedProfiles =
        queryClient.getQueryData<ProfileRecord[]>(queryKeys.profiles) ?? profiles;
      const targetProfile = cachedProfiles.find((entry) => entry.id === profileId);

      if (
        targetProfile?.role === 'admin' &&
        targetRole === 'member' &&
        !canDemoteProfile(cachedProfiles, profileId)
      ) {
        throw new Error(
          'Cannot demote the last remaining admin. Promote another team member to Admin first.'
        );
      }

      const { data, error } = await supabase
        .from('profiles')
        .update({ role: targetRole })
        .eq('id', profileId)
        .select('*')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles });

      if (user?.id === profileId) {
        await refreshProfile();
      }

      return data;
    },
  });

  const { mutateAsync: runUpdateRole } = updateRoleMutation;

  const updateUserRole = useCallback(
    (input: UpdateUserRoleInput) => runUpdateRole(input),
    [runUpdateRole]
  );

  return {
    profiles,
    adminCount,
    isLoading: canManageTeam ? query.isLoading : false,
    isError: canManageTeam ? query.isError : false,
    error: canManageTeam ? query.error : null,
    refetch: query.refetch,
    updateUserRole,
    isUpdating: updateRoleMutation.isPending,
  };
}
