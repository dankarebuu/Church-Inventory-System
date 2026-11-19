import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import type { ProfileRecord, UserRole } from '@/types/database';
import { useTeamRoles } from './useTeamRoles';

const {
  mockIsConfigured,
  mockAuthState,
  mockFrom,
  mockRefreshProfile,
  tableResults,
  updateCalls,
  resetMocks,
} = vi.hoisted(() => {
  const configured = { value: true };
  const refreshProfile = vi.fn(async () => {});
  const auth = {
    role: 'admin' as UserRole,
    user: { id: 'admin-1', email: 'dan@wingmacc.org' },
    profile: {
      id: 'admin-1',
      email: 'dan@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin' as const,
      created_at: '2026-11-18T00:00:00.000Z',
    },
    refreshProfile,
  };

  type TableResult = { data: unknown; error: { message: string } | null };
  const queryMap = new Map<string, TableResult>();
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    col: string;
    id: unknown;
  }> = [];

  const from = vi.fn((table: string) => {
    const getResult = (): TableResult => queryMap.get(table) ?? { data: [], error: null };

    const selectBuilder = {
      order: vi.fn(async () => getResult()),
      then: (
        onFulfilled: (value: TableResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
    };

    const updateFn = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn((col: string, id: unknown) => {
        updates.push({ table, payload, col, id });
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => getResult()),
          })),
          then: (
            onFulfilled: (value: TableResult) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve(getResult()).then(onFulfilled, onRejected),
        };
      }),
    }));

    return {
      select: vi.fn(() => selectBuilder),
      update: updateFn,
    };
  });

  return {
    mockIsConfigured: configured,
    mockAuthState: auth,
    mockFrom: from,
    mockRefreshProfile: refreshProfile,
    tableResults: queryMap,
    updateCalls: updates,
    resetMocks: () => {
      configured.value = true;
      auth.role = 'admin';
      auth.user = { id: 'admin-1', email: 'dan@wingmacc.org' };
      auth.profile = {
        id: 'admin-1',
        email: 'dan@wingmacc.org',
        first_name: 'Dan',
        last_name: 'Caleb',
        role: 'admin',
        created_at: '2026-11-18T00:00:00.000Z',
      };
      queryMap.clear();
      updates.length = 0;
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
  supabase: {
    from: mockFrom,
  },
}));

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

function makeProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: 'admin-1',
    email: 'dan@wingmacc.org',
    first_name: 'Dan',
    last_name: 'Caleb',
    role: 'admin',
    created_at: '2026-11-18T00:00:00.000Z',
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

describe('useTeamRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('never queries profiles when role is guest or member', async () => {
    const queryClient = createTestQueryClient();

    mockAuthState.role = 'guest';
    const guestHook = renderHook(() => useTeamRoles(), {
      wrapper: createWrapper(queryClient),
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(guestHook.result.current.profiles).toEqual([]);

    mockAuthState.role = 'member';
    const memberHook = renderHook(() => useTeamRoles(), {
      wrapper: createWrapper(queryClient),
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(memberHook.result.current.profiles).toEqual([]);

    await expect(
      memberHook.result.current.updateUserRole({
        profileId: 'user-2',
        targetRole: 'admin',
      })
    ).rejects.toThrow(/admin/i);
  });

  it('prevents demoting the last remaining admin before calling Supabase', async () => {
    const profiles = [
      makeProfile({ id: 'admin-1', role: 'admin' }),
      makeProfile({ id: 'member-1', email: 'eli@wingmacc.org', role: 'member' }),
    ];
    tableResults.set('profiles', { data: profiles, error: null });

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useTeamRoles(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });

    await expect(
      result.current.updateUserRole({
        profileId: 'admin-1',
        targetRole: 'member',
      })
    ).rejects.toThrow(/last.*admin/i);

    expect(updateCalls).toHaveLength(0);
  });

  it('updates role cleanly and calls refreshProfile when admin updates their own role with another admin present', async () => {
    const admin1 = makeProfile({ id: 'admin-1', role: 'admin' });
    const admin2 = makeProfile({
      id: 'admin-2',
      email: 'sarah@wingmacc.org',
      first_name: 'Sarah',
      last_name: 'Lee',
      role: 'admin',
    });
    tableResults.set('profiles', { data: [admin1, admin2], error: null });

    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const { result } = renderHook(() => useTeamRoles(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.profiles).toHaveLength(2);
    });

    tableResults.set('profiles', {
      data: { ...admin1, role: 'member' },
      error: null,
    });

    await result.current.updateUserRole({
      profileId: 'admin-1',
      targetRole: 'member',
    });

    expect(updateCalls).toEqual([
      {
        table: 'profiles',
        col: 'id',
        id: 'admin-1',
        payload: { role: 'member' },
      },
    ]);
    expect(mockRefreshProfile).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.profiles });
  });
});
