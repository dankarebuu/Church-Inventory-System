import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import type { ProfileRecord } from '@/types/database';
import {
  getActiveOfflineCacheUserId,
  getOfflineCacheKey,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
} from '@/lib/offlineCache';
import { queryKeys } from '@/lib/queryKeys';
import { AuthProvider, useAuth } from './useAuth';

type AuthStateCallback = (event: AuthChangeEvent, session: Session | null) => void;

const {
  mockGetSession,
  mockOnAuthStateChange,
  mockSignOut,
  mockFrom,
  mockMaybeSingle,
  mockEq,
  mockSelect,
  mockUnsubscribe,
  getAuthCallback,
  resetAuthCallback,
} = vi.hoisted(() => {
  let callback: AuthStateCallback | null = null;
  const unsubscribe = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getSession = vi.fn();
  const signOut = vi.fn();
  const onAuthStateChange = vi.fn((cb: AuthStateCallback) => {
    callback = cb;
    return {
      data: {
        subscription: {
          unsubscribe,
        },
      },
    };
  });

  return {
    mockGetSession: getSession,
    mockOnAuthStateChange: onAuthStateChange,
    mockSignOut: signOut,
    mockFrom: from,
    mockMaybeSingle: maybeSingle,
    mockEq: eq,
    mockSelect: select,
    mockUnsubscribe: unsubscribe,
    getAuthCallback: () => callback,
    resetAuthCallback: () => {
      callback = null;
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: mockSignOut,
    },
    from: mockFrom,
  },
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-123',
    app_metadata: {},
    user_metadata: { first_name: 'Dan', last_name: 'Caleb' },
    aud: 'authenticated',
    created_at: '2026-11-18T00:00:00.000Z',
    email: 'dan@wingmacc.org',
    ...overrides,
  } as User;
}

function makeSession(user: User): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  } as Session;
}

function AuthProbe() {
  const auth = useAuth();
  const location = useLocation();

  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="role">{auth.role}</span>
      <span data-testid="user-email">{auth.user?.email ?? 'none'}</span>
      <span data-testid="profile-name">
        {auth.profile ? `${auth.profile.first_name ?? ''} ${auth.profile.last_name ?? ''}`.trim() : 'none'}
      </span>
      <span data-testid="theme">{auth.theme}</span>
      <span data-testid="show-gateway">{String(auth.showGateway)}</span>
      <span data-testid="auth-modal-open">{String(auth.isAuthModalOpen)}</span>
      <span data-testid="pathname">{location.pathname}</span>
      <button type="button" onClick={auth.toggleTheme}>
        Toggle Theme
      </button>
      <button type="button" onClick={auth.dismissGateway}>
        Dismiss Gateway
      </button>
      <button type="button" onClick={() => auth.openAuthModal()}>
        Open Auth
      </button>
      <button type="button" onClick={auth.closeAuthModal}>
        Close Auth
      </button>
      <button type="button" onClick={() => void auth.signOut()}>
        Sign Out
      </button>
      <button type="button" onClick={() => void auth.refreshProfile()}>
        Refresh Profile
      </button>
    </div>
  );
}

function renderWithAuth(initialEntries: string[] = ['/dashboard']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('useAuth / AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthCallback();
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockSignOut.mockResolvedValue({ error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('resolves guest role without querying profiles when session is null and transitions isLoading cleanly', async () => {
    let resolveSession: ((value: { data: { session: Session | null }; error: null }) => void) | undefined;
    mockGetSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      })
    );

    renderWithAuth();

    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('role')).toHaveTextContent('guest');

    await act(async () => {
      resolveSession?.({ data: { session: null }, error: null });
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('role')).toHaveTextContent('guest');
    expect(screen.getByTestId('user-email')).toHaveTextContent('none');
    expect(screen.getByTestId('show-gateway')).toHaveTextContent('true');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('fetches profile row for authenticated users and maps admin and member roles', async () => {
    const adminUser = makeUser({ id: 'admin-1', email: 'admin@wingmacc.org' });
    const adminProfile: ProfileRecord = {
      id: 'admin-1',
      email: 'admin@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(adminUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: adminProfile, error: null });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', 'admin-1');
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('user-email')).toHaveTextContent('admin@wingmacc.org');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Dan Caleb');
    expect(screen.getByTestId('show-gateway')).toHaveTextContent('false');
  });

  it('falls back safely to member role when profile trigger has not created a row yet', async () => {
    const newMember = makeUser({ id: 'member-1', email: 'newmember@wingmacc.org' });

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(newMember) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(screen.getByTestId('role')).toHaveTextContent('member');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('none');
  });

  it('navigates to /reset-password when onAuthStateChange emits PASSWORD_RECOVERY', async () => {
    const recoveryUser = makeUser({ id: 'rec-1', email: 'recover@wingmacc.org' });
    const recoveryProfile: ProfileRecord = {
      id: 'rec-1',
      email: 'recover@wingmacc.org',
      first_name: 'Band',
      last_name: 'Member',
      role: 'member',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: recoveryProfile, error: null });

    const { unmount } = renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('pathname')).toHaveTextContent('/dashboard');

    await act(async () => {
      const cb = getAuthCallback();
      expect(cb).toBeTypeOf('function');
      cb?.('PASSWORD_RECOVERY', makeSession(recoveryUser));
    });

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/reset-password');
    });

    expect(screen.getByTestId('role')).toHaveTextContent('member');
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('persists wingmacc_theme to localStorage, meta color-scheme/theme-color, and syncs across storage events', async () => {
    const user = userEvent.setup();
    const colorSchemeMeta = document.createElement('meta');
    colorSchemeMeta.setAttribute('name', 'color-scheme');
    colorSchemeMeta.setAttribute('content', 'light dark');
    const themeColorMeta = document.createElement('meta');
    themeColorMeta.setAttribute('name', 'theme-color');
    themeColorMeta.setAttribute('content', '#F8FAFC');
    document.head.append(colorSchemeMeta, themeColorMeta);

    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    try {
      renderWithAuth();

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(colorSchemeMeta.getAttribute('content')).toBe('light');

      await user.click(screen.getByRole('button', { name: 'Toggle Theme' }));

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(localStorage.getItem('wingmacc_theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(colorSchemeMeta.getAttribute('content')).toBe('dark');
      expect(themeColorMeta.getAttribute('content')).toBe('#0B0F17');

      await user.click(screen.getByRole('button', { name: 'Toggle Theme' }));

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(localStorage.getItem('wingmacc_theme')).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(colorSchemeMeta.getAttribute('content')).toBe('light');
      expect(themeColorMeta.getAttribute('content')).toBe('#F8FAFC');

      // Syncs when another tab updates wingmacc_theme
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'wingmacc_theme', newValue: 'dark' })
        );
      });
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    } finally {
      colorSchemeMeta.remove();
      themeColorMeta.remove();
    }
  });

  it('animates theme toggles with View Transition circular reveal when supported and respects reduced motion', async () => {
    const user = userEvent.setup();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    const originalStartVt = (document as { startViewTransition?: unknown }).startViewTransition;
    const originalAnimate = HTMLElement.prototype.animate;
    const mockAnimate = vi.fn();
    let resolveReady!: () => void;
    let resolveFinished!: () => void;
    const mockStartViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {
        ready: new Promise<void>((res) => {
          resolveReady = res;
        }),
        finished: new Promise<void>((res) => {
          resolveFinished = res;
        }),
      };
    });

    (document as { startViewTransition?: unknown }).startViewTransition = mockStartViewTransition;
    HTMLElement.prototype.animate = mockAnimate as typeof HTMLElement.prototype.animate;

    try {
      renderWithAuth();
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
      });

      await user.click(screen.getByRole('button', { name: 'Toggle Theme' }));
      expect(mockStartViewTransition).toHaveBeenCalledTimes(1);
      expect(document.documentElement.getAttribute('data-theme-transition')).toBe('ripple');
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');

      await act(async () => {
        resolveReady();
        await Promise.resolve();
      });
      expect(mockAnimate).toHaveBeenCalledWith(
        expect.objectContaining({
          clipPath: expect.arrayContaining([expect.stringMatching(/^circle\(0px at /)]),
        }),
        expect.objectContaining({
          pseudoElement: '::view-transition-new(root)',
          duration: 380,
        })
      );

      await act(async () => {
        resolveFinished();
        await Promise.resolve();
      });
      expect(document.documentElement.hasAttribute('data-theme-transition')).toBe(false);
    } finally {
      (document as { startViewTransition?: unknown }).startViewTransition = originalStartVt;
      HTMLElement.prototype.animate = originalAnimate;
      document.documentElement.removeAttribute('data-theme-transition');
      document.documentElement.removeAttribute('data-theme-switching');
    }
  });

  it('persists gateway dismissal in sessionStorage and supports modal/refreshProfile/signOut actions', async () => {
    const user = userEvent.setup();
    const memberUser = makeUser({ id: 'member-2', email: 'member@wingmacc.org' });
    const initialProfile: ProfileRecord = {
      id: 'member-2',
      email: 'member@wingmacc.org',
      first_name: 'Old',
      last_name: 'Name',
      role: 'member',
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const updatedProfile: ProfileRecord = {
      ...initialProfile,
      first_name: 'Updated',
      last_name: 'Player',
    };

    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('show-gateway')).toHaveTextContent('true');

    await user.click(screen.getByRole('button', { name: 'Dismiss Gateway' }));
    expect(screen.getByTestId('show-gateway')).toHaveTextContent('false');
    expect(sessionStorage.getItem('wingmacc_gateway_dismissed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Open Auth' }));
    expect(screen.getByTestId('auth-modal-open')).toHaveTextContent('true');
    await user.click(screen.getByRole('button', { name: 'Close Auth' }));
    expect(screen.getByTestId('auth-modal-open')).toHaveTextContent('false');

    mockMaybeSingle.mockResolvedValueOnce({ data: initialProfile, error: null });
    await act(async () => {
      getAuthCallback()?.('SIGNED_IN', makeSession(memberUser));
    });

    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('Old Name');
    });

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(memberUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: updatedProfile, error: null });
    await user.click(screen.getByRole('button', { name: 'Refresh Profile' }));

    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('Updated Player');
    });

    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('guest');
      expect(screen.getByTestId('show-gateway')).toHaveTextContent('true');
    });
    expect(sessionStorage.getItem('wingmacc_gateway_dismissed')).toBeNull();
  });

  it('still navigates to /reset-password when TOKEN_REFRESHED overlaps an in-flight PASSWORD_RECOVERY profile fetch', async () => {
    const recoveryUser = makeUser({ id: 'rec-overlap', email: 'recover@wingmacc.org' });
    const recoveryProfile: ProfileRecord = {
      id: 'rec-overlap',
      email: 'recover@wingmacc.org',
      first_name: 'Band',
      last_name: 'Member',
      role: 'member',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    let resolveRecoveryFetch:
      | ((value: { data: ProfileRecord | null; error: null }) => void)
      | undefined;
    mockMaybeSingle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecoveryFetch = resolve;
        })
    );
    mockMaybeSingle.mockResolvedValueOnce({ data: recoveryProfile, error: null });

    await act(async () => {
      const cb = getAuthCallback();
      cb?.('PASSWORD_RECOVERY', makeSession(recoveryUser));
      cb?.('TOKEN_REFRESHED', makeSession(recoveryUser));
    });

    await act(async () => {
      resolveRecoveryFetch?.({ data: recoveryProfile, error: null });
    });

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/reset-password');
    });
    expect(screen.getByTestId('role')).toHaveTextContent('member');
  });

  it('does not navigate to /reset-password if SIGNED_OUT supersedes an in-flight PASSWORD_RECOVERY', async () => {
    const recoveryUser = makeUser({ id: 'rec-cancelled', email: 'recover@wingmacc.org' });

    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    let resolveRecoveryFetch:
      | ((value: { data: ProfileRecord | null; error: null }) => void)
      | undefined;
    mockMaybeSingle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecoveryFetch = resolve;
        })
    );

    await act(async () => {
      const cb = getAuthCallback();
      cb?.('PASSWORD_RECOVERY', makeSession(recoveryUser));
      cb?.('SIGNED_OUT', null);
    });

    await act(async () => {
      resolveRecoveryFetch?.({ data: null, error: null });
    });

    expect(screen.getByTestId('pathname')).toHaveTextContent('/dashboard');
    expect(screen.getByTestId('role')).toHaveTextContent('guest');
  });

  it('preserves existing admin profile on transient profiles query errors during TOKEN_REFRESHED and refreshProfile', async () => {
    const user = userEvent.setup();
    const adminUser = makeUser({ id: 'admin-keep', email: 'admin@wingmacc.org' });
    const adminProfile: ProfileRecord = {
      id: 'admin-keep',
      email: 'admin@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(adminUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: adminProfile, error: null });

    renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Dan Caleb');

    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'PostgREST transient failure' },
    });

    await act(async () => {
      getAuthCallback()?.('TOKEN_REFRESHED', makeSession(adminUser));
    });

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Dan Caleb');

    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Temporary network error' },
    });

    await user.click(screen.getByRole('button', { name: 'Refresh Profile' }));

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Dan Caleb');

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await user.click(screen.getByRole('button', { name: 'Refresh Profile' }));

    await waitFor(() => {
      expect(screen.getByTestId('profile-name')).toHaveTextContent('none');
    });
    expect(screen.getByTestId('role')).toHaveTextContent('member');
  });

  it('still navigates to /reset-password when refreshProfile overlaps an in-flight PASSWORD_RECOVERY and does not carry over another users admin profile on error', async () => {
    const user = userEvent.setup();
    const adminUser = makeUser({ id: 'admin-prev', email: 'admin@wingmacc.org' });
    const adminProfile: ProfileRecord = {
      id: 'admin-prev',
      email: 'admin@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const memberUser = makeUser({ id: 'member-next', email: 'member@wingmacc.org' });
    const memberProfile: ProfileRecord = {
      id: 'member-next',
      email: 'member@wingmacc.org',
      first_name: 'Band',
      last_name: 'Member',
      role: 'member',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(adminUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: adminProfile, error: null });

    renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('admin');
    });

    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Transient error for new user' },
    });

    await act(async () => {
      getAuthCallback()?.('SIGNED_IN', makeSession(memberUser));
    });

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('member@wingmacc.org');
    });
    expect(screen.getByTestId('role')).toHaveTextContent('member');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('none');

    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    let resolveRecoveryFetch:
      | ((value: { data: ProfileRecord | null; error: null }) => void)
      | undefined;
    mockMaybeSingle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecoveryFetch = resolve;
        })
    );
    mockMaybeSingle.mockResolvedValueOnce({ data: memberProfile, error: null });

    await act(async () => {
      getAuthCallback()?.('PASSWORD_RECOVERY', makeSession(memberUser));
    });

    await user.click(screen.getByRole('button', { name: 'Refresh Profile' }));

    await act(async () => {
      resolveRecoveryFetch?.({ data: memberProfile, error: null });
    });

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/reset-password');
    });
    expect(screen.getByTestId('role')).toHaveTextContent('member');
  });

  it('purges offline catalog snapshots immediately inside signOut without clearing theme preference', async () => {
    const user = userEvent.setup();
    const adminUser = makeUser({ id: 'admin-purge', email: 'admin@wingmacc.org' });
    const adminProfile: ProfileRecord = {
      id: 'admin-purge',
      email: 'admin@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    localStorage.setItem('wingmacc_theme', 'dark');
    saveOfflineSnapshot('admin-purge', { inventory: [], categories: [] });
    saveOfflineSnapshot('guest', { inventory: [], categories: [] });

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(adminUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: adminProfile, error: null });

    renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('admin');
    });
    expect(getActiveOfflineCacheUserId()).toBe('admin-purge');
    expect(loadOfflineSnapshot('admin-purge')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Sign Out' }));

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('guest');
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(getActiveOfflineCacheUserId()).toBeNull();
    expect(localStorage.getItem(getOfflineCacheKey('admin-purge'))).toBeNull();
    expect(localStorage.getItem(getOfflineCacheKey('guest'))).toBeNull();
    expect(localStorage.getItem('wingmacc_theme')).toBe('dark');
  });

  it('purges offline caches immediately and falls back to local sign-out when supabase.auth.signOut returns an error', async () => {
    const user = userEvent.setup();
    const adminUser = makeUser({ id: 'admin-err', email: 'err@wingmacc.org' });
    const adminProfile: ProfileRecord = {
      id: 'admin-err',
      email: 'err@wingmacc.org',
      first_name: 'Err',
      last_name: 'Admin',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    saveOfflineSnapshot('admin-err', { inventory: [], categories: [] });
    saveOfflineSnapshot('guest', { inventory: [], categories: [] });

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(adminUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: adminProfile, error: null });

    let resolveRemoteSignOut: ((value: { error: { message: string } }) => void) | undefined;
    mockSignOut
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRemoteSignOut = resolve;
          })
      )
      .mockResolvedValueOnce({ error: null });

    renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('admin');
    });
    expect(loadOfflineSnapshot('admin-err')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Sign Out' }));

    // Cache MUST be purged synchronously before remote signOut resolves.
    expect(getActiveOfflineCacheUserId()).toBeNull();
    expect(localStorage.getItem(getOfflineCacheKey('admin-err'))).toBeNull();
    expect(localStorage.getItem(getOfflineCacheKey('guest'))).toBeNull();

    await act(async () => {
      resolveRemoteSignOut?.({ error: { message: 'Network request failed' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('guest');
    });
    expect(screen.getByTestId('user-email')).toHaveTextContent('none');
    expect(mockSignOut).toHaveBeenNthCalledWith(1);
    expect(mockSignOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
  });

  it('clears session state and offline caches even when offline signOut and local fallback reject', async () => {
    const user = userEvent.setup();
    const memberUser = makeUser({ id: 'member-offline', email: 'member@wingmacc.org' });
    const memberProfile: ProfileRecord = {
      id: 'member-offline',
      email: 'member@wingmacc.org',
      first_name: 'Offline',
      last_name: 'Member',
      role: 'member',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    saveOfflineSnapshot('member-offline', { inventory: [], categories: [] });
    mockGetSession.mockResolvedValue({
      data: { session: makeSession(memberUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: memberProfile, error: null });

    mockSignOut
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Storage unavailable'));

    renderWithAuth(['/dashboard']);

    await waitFor(() => {
      expect(screen.getByTestId('user-email')).toHaveTextContent('member@wingmacc.org');
    });

    await user.click(screen.getByRole('button', { name: 'Sign Out' }));

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('guest');
    });
    expect(screen.getByTestId('user-email')).toHaveTextContent('none');
    expect(getActiveOfflineCacheUserId()).toBeNull();
    expect(localStorage.getItem(getOfflineCacheKey('member-offline'))).toBeNull();
    expect(mockSignOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
  });

  it('clears private TanStack Query caches on signOut and SIGNED_OUT when QueryClientProvider is present', async () => {
    const user = userEvent.setup();
    const adminUser = makeUser({ id: 'admin-qc', email: 'admin@wingmacc.org' });
    const adminProfile: ProfileRecord = {
      id: 'admin-qc',
      email: 'admin@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.inventory('admin'), [{ id: 'item-1', checkedBy: 'Dan' }]);
    queryClient.setQueryData(queryKeys.loans, [{ id: 'loan-1', borrower_name: 'Joel' }]);
    queryClient.setQueryData(queryKeys.history, [{ id: 'h-1', user_email: 'admin@wingmacc.org' }]);
    queryClient.setQueryData(queryKeys.profiles, [adminProfile]);
    queryClient.setQueryData(queryKeys.itemComments('item-1'), [{ id: 'c-1', body: 'Private note' }]);
    queryClient.setQueryData(queryKeys.commentCounts, { 'item-1': 1 });
    queryClient.setQueryData(queryKeys.categories, [{ id: 'cat-1', name: 'Drums' }]);

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(adminUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: adminProfile, error: null });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <AuthProvider>
            <AuthProbe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('admin');
    });

    await user.click(screen.getByRole('button', { name: 'Sign Out' }));

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('guest');
    });

    expect(queryClient.getQueryData(queryKeys.inventory('admin'))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.loans)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.history)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.profiles)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.itemComments('item-1'))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.commentCounts)).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.categories)).toEqual([{ id: 'cat-1', name: 'Drums' }]);
  });
});
