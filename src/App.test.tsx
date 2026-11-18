import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/useAuth';
import { App, AppRoutes, createAppQueryClient } from './App';

const { mockGetSession, mockOnAuthStateChange, mockChannel, mockRemoveChannel } = vi.hoisted(() => {
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
    from: vi.fn((table: string) => ({
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
                    role: 'member',
                    created_at: '2026-11-18T00:00:00.000Z',
                  },
                  error: null,
                }
              : { data: null, error: null }
          ),
        })),
        order: vi.fn(async () => ({ data: [], error: null })),
        is: vi.fn(async () => ({ data: [], error: null })),
        then: (
          onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected),
      })),
    })),
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
});
