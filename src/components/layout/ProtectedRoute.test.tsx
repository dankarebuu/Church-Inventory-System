import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { UserRole } from '@/types/database';
import { ProtectedRoute } from './ProtectedRoute';

const mockUseAuth = vi.fn<() => AuthContextValue>();

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

function makeAuthValue(role: UserRole, isLoading = false): AuthContextValue {
  return {
    user: null,
    profile: null,
    role,
    isLoading,
    theme: 'light',
    toggleTheme: vi.fn(),
    showGateway: false,
    dismissGateway: vi.fn(),
    openAuthModal: vi.fn(),
    closeAuthModal: vi.fn(),
    isAuthModalOpen: false,
    authModalMode: 'login',
    setAuthModalMode: vi.fn(),
    signOut: vi.fn(async () => {}),
    refreshProfile: vi.fn(async () => {}),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

function renderGuardedRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path="/dashboard" element={<div>Dashboard Target</div>} />
        <Route
          path="/loans"
          element={
            <ProtectedRoute allowedRoles={['member', 'admin']}>
              <div>Loans Protected Content</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity"
          element={
            <ProtectedRoute allowedRoles={['member', 'admin']}>
              <div>Activity Protected Content</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/team"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <div>Team Roles Protected Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a loading placeholder while auth is loading and waits to resolve before redirecting or rendering', () => {
    mockUseAuth.mockReturnValue(makeAuthValue('guest', true));

    const { rerender } = render(
      <MemoryRouter initialEntries={['/team']}>
        <LocationProbe />
        <Routes>
          <Route path="/dashboard" element={<div>Dashboard Target</div>} />
          <Route
            path="/team"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <div>Team Roles Protected Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Team Roles Protected Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard Target')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/team');

    mockUseAuth.mockReturnValue(makeAuthValue('admin', false));

    rerender(
      <MemoryRouter initialEntries={['/team']}>
        <LocationProbe />
        <Routes>
          <Route path="/dashboard" element={<div>Dashboard Target</div>} />
          <Route
            path="/team"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <div>Team Roles Protected Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Team Roles Protected Content')).toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/team');
  });

  it('redirects guests visiting /loans or /activity to /dashboard without rendering children', () => {
    mockUseAuth.mockReturnValue(makeAuthValue('guest', false));

    const { unmount } = renderGuardedRoutes('/loans');
    expect(screen.getByText('Dashboard Target')).toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/dashboard');
    expect(screen.queryByText('Loans Protected Content')).not.toBeInTheDocument();
    unmount();

    renderGuardedRoutes('/activity');
    expect(screen.getByText('Dashboard Target')).toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/dashboard');
    expect(screen.queryByText('Activity Protected Content')).not.toBeInTheDocument();
  });

  it('redirects members visiting /team to /dashboard while allowing /loans and /activity', () => {
    mockUseAuth.mockReturnValue(makeAuthValue('member', false));

    const { unmount: unmountTeam } = renderGuardedRoutes('/team');
    expect(screen.getByText('Dashboard Target')).toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/dashboard');
    expect(screen.queryByText('Team Roles Protected Content')).not.toBeInTheDocument();
    unmountTeam();

    const { unmount: unmountLoans } = renderGuardedRoutes('/loans');
    expect(screen.getByText('Loans Protected Content')).toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/loans');
    unmountLoans();

    renderGuardedRoutes('/activity');
    expect(screen.getByText('Activity Protected Content')).toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/activity');
  });

  it('allows admins to view admin-only routes', () => {
    mockUseAuth.mockReturnValue(makeAuthValue('admin', false));

    renderGuardedRoutes('/team');
    expect(screen.getByText('Team Roles Protected Content')).toBeInTheDocument();
    expect(screen.getByTestId('location-pathname')).toHaveTextContent('/team');
  });
});
