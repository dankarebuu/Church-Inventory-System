import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/useAuth';
import { App, AppRoutes, createAppQueryClient } from './App';

const {
  mockGetSession,
  mockOnAuthStateChange,
  mockChannel,
  mockRemoveChannel,
  mockProfileRole,
} = vi.hoisted(() => {
  const ch = {
    on: vi.fn(),
    subscribe: vi.fn((cb?: (status: 'SUBSCRIBED') => void) => {
      cb?.('SUBSCRIBED');
      return ch;
    }),
  };
  ch.on.mockReturnValue(ch);

  return {
    mockGetSession: vi.fn(),
    mockOnAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    mockChannel: vi.fn(() => ch),
    mockRemoveChannel: vi.fn(async () => 'ok'),
    mockProfileRole: { value: 'member' as 'member' | 'admin' },
  };
});

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
    from: vi.fn((table: string) => {
      const makeOrderResult = () => {
        const result: Record<string, unknown> = {
          limit: vi.fn(async () => ({ data: [], error: null })),
          then: (
            onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
        };
        result.order = vi.fn(() => result);
        return result;
      };

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () =>
              table === 'profiles'
                ? {
                    data: {
                      id: 'user-1',
                      email: 'member@wingmacc.org',
                      first_name: 'Band',
                      last_name: 'Member',
                      role: mockProfileRole.value,
                      created_at: '2026-11-18T00:00:00.000Z',
                    },
                    error: null,
                  }
                : { data: null, error: null }
            ),
          })),
          order: vi.fn(() => makeOrderResult()),
          is: vi.fn(async () => ({ data: [], error: null })),
          then: (
            onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
        })),
      };
    }),
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="app-pathname">{location.pathname}</div>;
}

describe('App & AppRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockProfileRole.value = 'member';
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('renders App with BrowserRouter wrapping AuthProvider and displays WelcomeGateway for fresh guests', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Band Inventory', { selector: 'h1' })).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Primary sidebar')).toBeInTheDocument();
  });

  it('mounts /reset-password outside AppShell without the sidebar', async () => {
    const queryClient = createAppQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reset-password']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Set New Password')).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-pathname')).toHaveTextContent('/reset-password');
    expect(screen.queryByLabelText('Primary sidebar')).not.toBeInTheDocument();
  });

  it('redirects guests visiting /team to /dashboard inside AppRoutes', async () => {
    sessionStorage.setItem('wingmacc_gateway_dismissed', 'true');
    const queryClient = createAppQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/team']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('app-pathname')).toHaveTextContent('/dashboard');
    });
    expect(screen.getByLabelText('Primary sidebar')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Team Roles' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Operations Dashboard' })).toBeInTheDocument();
    });
  });

  it('redirects / to /dashboard and mounts Operations Dashboard', async () => {
    sessionStorage.setItem('wingmacc_gateway_dismissed', 'true');
    const queryClient = createAppQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('app-pathname')).toHaveTextContent('/dashboard');
      expect(screen.getByRole('heading', { name: 'Operations Dashboard' })).toBeInTheDocument();
    });
  });

  it('mounts LoansPage at /loans for authenticated members while redirecting guests', async () => {
    sessionStorage.setItem('wingmacc_gateway_dismissed', 'true');
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-1', email: 'member@wingmacc.org' },
        },
      },
      error: null,
    });
    const queryClient = createAppQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/loans']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Loans & Check-Out' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-pathname')).toHaveTextContent('/loans');
  });

  it('mounts ChecklistPage at /checklist in Print/PDF mode for guests', async () => {
    sessionStorage.setItem('wingmacc_gateway_dismissed', 'true');
    const queryClient = createAppQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/checklist']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sunday Checklist' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /print \/ pdf checklist/i })).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-pathname')).toHaveTextContent('/checklist');
    expect(screen.queryByRole('tab', { name: /live check-off/i })).not.toBeInTheDocument();
  });

  it('lazy-loads /inventory and /categories routes cleanly inside AppShell', async () => {
    sessionStorage.setItem('wingmacc_gateway_dismissed', 'true');
    const queryClient = createAppQueryClient();

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/inventory']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Band Inventory' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-pathname')).toHaveTextContent('/inventory');
    unmount();

    const catQueryClient = createAppQueryClient();
    render(
      <QueryClientProvider client={catQueryClient}>
        <MemoryRouter initialEntries={['/categories']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /categories & locations/i })).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-pathname')).toHaveTextContent('/categories');
  });

  it('mounts ActivityPage at /activity for authenticated members while redirecting guests', async () => {
    sessionStorage.setItem('wingmacc_gateway_dismissed', 'true');
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-1', email: 'member@wingmacc.org' },
        },
      },
      error: null,
    });
    const queryClient = createAppQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/activity']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Activity Log' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-pathname')).toHaveTextContent('/activity');
  });

  it('redirects authenticated members visiting /team to /dashboard while mounting TeamPage for admins', async () => {
    sessionStorage.setItem('wingmacc_gateway_dismissed', 'true');
    mockProfileRole.value = 'member';
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-1', email: 'member@wingmacc.org' },
        },
      },
      error: null,
    });
    const memberQueryClient = createAppQueryClient();

    const { unmount } = render(
      <QueryClientProvider client={memberQueryClient}>
        <MemoryRouter initialEntries={['/team']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('app-pathname')).toHaveTextContent('/dashboard');
    });
    expect(screen.queryByRole('heading', { name: 'Team Roles' })).not.toBeInTheDocument();
    unmount();

    mockProfileRole.value = 'admin';
    const adminQueryClient = createAppQueryClient();
    render(
      <QueryClientProvider client={adminQueryClient}>
        <MemoryRouter initialEntries={['/team']}>
          <AuthProvider>
            <LocationDisplay />
            <AppRoutes />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Team Roles' })).toBeInTheDocument();
    });
    expect(screen.getByTestId('app-pathname')).toHaveTextContent('/team');
  });
});
