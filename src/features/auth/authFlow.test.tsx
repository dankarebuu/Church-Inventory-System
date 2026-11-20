import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, User } from '@supabase/supabase-js';
import type { ProfileRecord } from '@/types/database';
import { AccountSettingsDialog } from './AccountSettingsDialog';
import { AuthModal } from './AuthModal';
import { AuthProvider, useAuth } from './useAuth';
import { WelcomeGateway } from './WelcomeGateway';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';

const {
  mockGetSession,
  mockOnAuthStateChange,
  mockSignInWithPassword,
  mockSignUp,
  mockResetPasswordForEmail,
  mockUpdateUser,
  mockSignOut,
  mockMaybeSingle,
  mockFrom,
  mockIsConfigured,
} = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    mockGetSession: vi.fn(),
    mockOnAuthStateChange: vi.fn(
      (_cb?: (event: string, session: Session | null) => void) => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })
    ),
    mockSignInWithPassword: vi.fn(),
    mockSignUp: vi.fn(),
    mockResetPasswordForEmail: vi.fn(),
    mockUpdateUser: vi.fn(),
    mockSignOut: vi.fn(),
    mockMaybeSingle: maybeSingle,
    mockFrom: from,
    mockIsConfigured: { value: true },
  };
});

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      resetPasswordForEmail: mockResetPasswordForEmail,
      updateUser: mockUpdateUser,
      signOut: mockSignOut,
    },
    from: mockFrom,
  },
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
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
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user,
  } as Session;
}

function Harness() {
  const { openAuthModal } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();

  return (
    <div>
      <span data-testid="route">{location.pathname}</span>
      <button type="button" onClick={() => openAuthModal('login')}>
        Trigger Login
      </button>
      <button type="button" onClick={() => setSettingsOpen(true)}>
        Trigger Account Settings
      </button>
      <WelcomeGateway />
      <AuthModal />
      <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

describe('Auth UI flows (WelcomeGateway, AuthModal, AccountSettingsDialog, ResetPasswordPage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.value = true;
    localStorage.clear();
    sessionStorage.clear();
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSignInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });
    mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    mockUpdateUser.mockResolvedValue({ data: { user: makeUser() }, error: null });
    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders WelcomeGateway with WINGMACC brand elements and persists guest dismissal across reloads', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Band Inventory')).toBeInTheDocument();
    });

    const logo = screen.getByAltText('WINGMACC logo');
    expect(logo).toHaveAttribute('src', '/images/logo.svg');
    expect(screen.getByText('CHURCH PROPERTY INVENTORY LOG')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Continue as Guest \(View Only\)/i }));

    expect(screen.queryByText('Band Inventory')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('wingmacc_gateway_dismissed')).toBe('true');

    unmount();

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText('Band Inventory')).not.toBeInTheDocument();
  });

  it('uses Radix Dialog accessibility (aria-describedby, focus containment, and Escape dismissal) on WelcomeGateway', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    const dialog = await screen.findByRole('dialog', { name: /band inventory/i });
    const labelledById = dialog.getAttribute('aria-labelledby');
    expect(labelledById).toBeTruthy();
    expect(document.getElementById(labelledById!)).toHaveTextContent('Band Inventory');
    const describedById = dialog.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)).toHaveTextContent(
      'Band Department Inventory System'
    );
    // Radix modal dialog hides background content from the accessibility tree while open
    expect(screen.queryByRole('button', { name: 'Trigger Login' })).not.toBeInTheDocument();

    const loginBtn = screen.getByRole('button', { name: /Login to Edit/i });
    const guestBtn = screen.getByRole('button', { name: /Continue as Guest \(View Only\)/i });

    // Tabbing cycles focus inside the modal rather than escaping to background buttons
    loginBtn.focus();
    expect(loginBtn).toHaveFocus();
    await user.tab();
    expect(guestBtn).toHaveFocus();
    await user.tab();
    expect(loginBtn).toHaveFocus();

    // Pressing Escape dismisses WelcomeGateway and persists session dismissal
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /band inventory/i })).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem('wingmacc_gateway_dismissed')).toBe('true');
  });

  it('auto-hides WelcomeGateway when a user is authenticated', async () => {
    const authUser = makeUser();
    const profile: ProfileRecord = {
      id: authUser.id,
      email: 'dan@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };
    mockGetSession.mockResolvedValue({
      data: { session: makeSession(authUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: profile, error: null });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalled();
    });

    expect(screen.queryByText('Band Inventory')).not.toBeInTheDocument();
  });

  it('supports login, password visibility toggle, restricted signup JSX notice, and forgot password redirect', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Login to Edit/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Login to Edit/i }));
    expect(screen.getByRole('heading', { name: 'Account Login' })).toBeInTheDocument();

    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput.type).toBe('text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument();

    mockSignUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Signups not allowed for this instance' },
    });

    await user.type(screen.getByLabelText('First Name'), 'Dan');
    await user.type(screen.getByLabelText('Last Name'), 'Caleb');
    await user.type(screen.getByLabelText('Email Address'), 'dan@wingmacc.org');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));

    await waitFor(() => {
      expect(screen.getByText(/Contact Admin: Dan Caleb/i)).toBeInTheDocument();
    });
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'dan@wingmacc.org',
      password: 'secret123',
      options: {
        data: {
          username: 'Dan Caleb',
          full_name: 'Dan Caleb',
          first_name: 'Dan',
          last_name: 'Caleb',
        },
      },
    });

    await user.click(screen.getByRole('button', { name: 'Already have an account? Login' }));
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset Password' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Email Address'));
    await user.type(screen.getByLabelText('Email Address'), 'member@wingmacc.org');
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    await waitFor(() => {
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith('member@wingmacc.org', {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    });
    expect(screen.getByText(/Reset link sent! Check your email inbox./i)).toBeInTheDocument();
  });

  it('updates first_name, last_name, and optional password in AccountSettingsDialog and refreshes profile', async () => {
    const user = userEvent.setup();
    const authUser = makeUser();
    const profile: ProfileRecord = {
      id: authUser.id,
      email: 'dan@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };
    mockGetSession.mockResolvedValue({
      data: { session: makeSession(authUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({ data: profile, error: null });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: 'Trigger Account Settings' }));

    const firstInput = screen.getByLabelText('First Name') as HTMLInputElement;
    const lastInput = screen.getByLabelText('Last Name') as HTMLInputElement;
    expect(firstInput.value).toBe('Dan');
    expect(lastInput.value).toBe('Caleb');

    await user.clear(firstInput);
    await user.type(firstInput, 'Daniel');
    await user.type(screen.getByLabelText('New Password (Optional)'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm New Password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({
        data: {
          first_name: 'Daniel',
          last_name: 'Caleb',
          username: 'Daniel Caleb',
          full_name: 'Daniel Caleb',
        },
        password: 'newpass123',
      });
    });

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
    });
  });

  it('submits ResetPasswordPage and navigates to /dashboard on success', async () => {
    const user = userEvent.setup();
    const authUser = makeUser();
    mockGetSession.mockResolvedValue({
      data: { session: makeSession(authUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: authUser.id,
        email: 'dan@wingmacc.org',
        first_name: 'Dan',
        last_name: 'Caleb',
        role: 'member',
        created_at: '2026-11-18T00:00:00.000Z',
      },
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AuthProvider>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/dashboard" element={<div>Dashboard Landing</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('New Password')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('New Password'), 'bandpass99');
    await user.type(screen.getByLabelText('Confirm Password'), 'bandpass99');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'bandpass99' });
    });

    await waitFor(() => {
      expect(screen.getByText('Dashboard Landing')).toBeInTheDocument();
    });
  });

  it('shows unconfigured notice in AuthModal when Supabase env vars are missing', async () => {
    const user = userEvent.setup();
    mockIsConfigured.value = false;

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Login to Edit/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Login to Edit/i }));
    expect(screen.getByText('Supabase is not configured')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email Address'), 'dan@wingmacc.org');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Login' }));

    expect(mockSignInWithPassword).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Supabase is not configured\. Add VITE_SUPABASE_URL/i)
    ).toBeInTheDocument();
  });

  it('preserves unsaved AccountSettingsDialog edits across background TOKEN_REFRESHED auth updates', async () => {
    const user = userEvent.setup();
    const authUser = makeUser();
    const initialProfile: ProfileRecord = {
      id: authUser.id,
      email: 'dan@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin',
      created_at: '2026-11-18T00:00:00.000Z',
    };
    const refreshedProfile: ProfileRecord = {
      ...initialProfile,
      first_name: 'ServerFirst',
      last_name: 'ServerLast',
    };

    mockGetSession.mockResolvedValue({
      data: { session: makeSession(authUser) },
      error: null,
    });
    mockMaybeSingle
      .mockResolvedValueOnce({ data: initialProfile, error: null })
      .mockResolvedValueOnce({ data: refreshedProfile, error: null });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: 'Trigger Account Settings' }));

    const firstInput = screen.getByLabelText('First Name') as HTMLInputElement;
    const lastInput = screen.getByLabelText('Last Name') as HTMLInputElement;
    await user.clear(firstInput);
    await user.type(firstInput, 'Daniel');
    await user.clear(lastInput);
    await user.type(lastInput, 'BandLead');
    await user.type(screen.getByLabelText('New Password (Optional)'), 'draftpass123');
    await user.type(screen.getByLabelText('Confirm New Password'), 'draftpass123');

    const authListener = mockOnAuthStateChange.mock.calls[0]?.[0] as
      | ((event: string, session: Session | null) => void)
      | undefined;
    expect(authListener).toBeDefined();

    await act(async () => {
      authListener?.(
        'TOKEN_REFRESHED',
        makeSession(makeUser({ user_metadata: { first_name: 'ServerFirst', last_name: 'ServerLast' } }))
      );
    });

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
    });

    expect((screen.getByLabelText('First Name') as HTMLInputElement).value).toBe('Daniel');
    expect((screen.getByLabelText('Last Name') as HTMLInputElement).value).toBe('BandLead');
    expect((screen.getByLabelText('New Password (Optional)') as HTMLInputElement).value).toBe(
      'draftpass123'
    );
    expect((screen.getByLabelText('Confirm New Password') as HTMLInputElement).value).toBe(
      'draftpass123'
    );
  });

  it('dismisses WelcomeGateway when requesting a new reset link, detects signup_disabled code, and surfaces rejected network errors across auth forms', async () => {
    const user = userEvent.setup();

    // 1. Expired ResetPasswordPage -> Request New Reset Link dismisses WelcomeGateway and opens forgot modal cleanly
    const { unmount } = render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AuthProvider>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/dashboard" element={<Harness />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /request new reset link/i })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /request new reset link/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Reset Password' })).toBeInTheDocument();
    });
    expect(sessionStorage.getItem('wingmacc_gateway_dismissed')).toBe('true');
    expect(
      screen.queryByRole('button', { name: /continue as guest/i })
    ).not.toBeInTheDocument();

    // 2. Network rejections in AuthModal (forgot, login, signup) and code === 'signup_disabled'
    mockResetPasswordForEmail.mockRejectedValueOnce(new Error('Reset network timeout'));
    await user.type(screen.getByLabelText('Email Address'), 'member@wingmacc.org');
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reset network timeout/i);

    await user.click(screen.getByRole('button', { name: 'Back to Login' }));
    mockSignInWithPassword.mockRejectedValueOnce(new Error('Login network error'));
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Login' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/login network error/i);

    await user.click(screen.getByRole('button', { name: 'Need an account? Sign up' }));
    await user.type(screen.getByLabelText('First Name'), 'Dan');
    await user.type(screen.getByLabelText('Last Name'), 'Caleb');
    await user.type(screen.getByLabelText('Password'), 'secret123');

    mockSignUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'User creation blocked', code: 'signup_disabled' },
    });
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    expect(await screen.findByText(/Contact Admin: Dan Caleb/i)).toBeInTheDocument();

    mockSignUp.mockRejectedValueOnce(new Error('Signup network down'));
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/signup network down/i);
    unmount();

    // 3. Network rejection in AccountSettingsDialog and ResetPasswordPage
    const authUser = makeUser();
    mockGetSession.mockResolvedValue({
      data: { session: makeSession(authUser) },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: authUser.id,
        email: 'dan@wingmacc.org',
        first_name: 'Dan',
        last_name: 'Caleb',
        role: 'member',
        created_at: '2026-11-18T00:00:00.000Z',
      },
      error: null,
    });

    const { unmount: unmountSettings } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalled();
    });
    await user.click(screen.getByRole('button', { name: 'Trigger Account Settings' }));
    mockUpdateUser.mockRejectedValueOnce(new Error('Settings network failure'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/settings network failure/i);
    expect(screen.getByRole('button', { name: 'Save Changes' })).not.toBeDisabled();
    unmountSettings();

    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AuthProvider>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('New Password')).toBeInTheDocument();
    });
    mockUpdateUser.mockRejectedValueOnce(new Error('Update password offline'));
    await user.type(screen.getByLabelText('New Password'), 'bandpass99');
    await user.type(screen.getByLabelText('Confirm Password'), 'bandpass99');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/update password offline/i);
    expect(screen.getByRole('button', { name: 'Update Password' })).not.toBeDisabled();
  });
});
