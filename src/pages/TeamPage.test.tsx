import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { ProfileRecord } from '@/types/database';
import { TeamPage } from './TeamPage';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseTeamRoles = vi.fn();
const mockUpdateUserRole = vi.fn();

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/features/team/useTeamRoles', async () => {
  const actual = await vi.importActual<typeof import('@/features/team/useTeamRoles')>(
    '@/features/team/useTeamRoles'
  );
  return {
    ...actual,
    useTeamRoles: () => mockUseTeamRoles(),
  };
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const adminOne: ProfileRecord = {
  id: 'admin-1',
  email: 'dan@wingmacc.org',
  first_name: 'Dan',
  last_name: 'Caleb',
  role: 'admin',
  created_at: '2026-11-10T00:00:00.000Z',
};

const adminTwo: ProfileRecord = {
  id: 'admin-2',
  email: 'sarah@wingmacc.org',
  first_name: 'Sarah',
  last_name: 'Lee',
  role: 'admin',
  created_at: '2026-11-12T00:00:00.000Z',
};

const memberOne: ProfileRecord = {
  id: 'member-1',
  email: 'eli@wingmacc.org',
  first_name: 'Eli',
  last_name: 'Cruz',
  role: 'member',
  created_at: '2026-11-15T00:00:00.000Z',
};

function makeAdminAuth(): AuthContextValue {
  return {
    user: { id: 'admin-1', email: 'dan@wingmacc.org' } as never,
    profile: adminOne,
    role: 'admin',
    isLoading: false,
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

function renderTeamPage(profiles: ProfileRecord[]) {
  mockUseAuth.mockReturnValue(makeAdminAuth());
  const adminCount = profiles.filter((p) => p.role === 'admin').length;
  mockUseTeamRoles.mockReturnValue({
    profiles,
    adminCount,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    updateUserRole: mockUpdateUserRole,
    isUpdating: false,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TeamPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TeamPage', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = MockResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUserRole.mockResolvedValue({});
  });

  it('locks demotion of the last remaining admin and shows Supabase Auth invite guidance', async () => {
    const user = userEvent.setup();
    renderTeamPage([adminOne, memberOne]);

    expect(screen.getByRole('heading', { name: 'Team Roles' })).toBeInTheDocument();
    expect(screen.getByText(/supabase auth dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/last admin cannot be demoted/i)).toBeInTheDocument();

    const demoteBtn = screen.getByRole('button', { name: /demote to member/i });
    expect(demoteBtn).toBeDisabled();

    const promoteBtn = screen.getByRole('button', { name: /promote to admin/i });
    expect(promoteBtn).toBeEnabled();
    await user.click(promoteBtn);

    await waitFor(() => {
      expect(mockUpdateUserRole).toHaveBeenCalledWith({
        profileId: 'member-1',
        targetRole: 'admin',
      });
    });
  });

  it('requires AlertDialog confirmation for self-demotion when another admin exists', async () => {
    const user = userEvent.setup();
    renderTeamPage([adminOne, adminTwo, memberOne]);

    expect(screen.queryByText(/last admin cannot be demoted/i)).not.toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    const selfRow = rows.find((row) => within(row).queryByText('dan@wingmacc.org'));
    expect(selfRow).toBeDefined();

    await user.click(within(selfRow!).getByRole('button', { name: /demote to member/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/step down to band member/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /confirm self-demotion/i }));

    await waitFor(() => {
      expect(mockUpdateUserRole).toHaveBeenCalledWith({
        profileId: 'admin-1',
        targetRole: 'member',
      });
    });
  });

  it('filters profiles by search query and role dropdown with Clear Filters', async () => {
    const user = userEvent.setup();
    renderTeamPage([adminOne, adminTwo, memberOne]);

    expect(screen.getByText('dan@wingmacc.org')).toBeInTheDocument();
    expect(screen.getByText('sarah@wingmacc.org')).toBeInTheDocument();
    expect(screen.getByText('eli@wingmacc.org')).toBeInTheDocument();

    // Search by name or email
    await user.type(screen.getByPlaceholderText(/search team members/i), 'sarah');
    expect(screen.getByText('sarah@wingmacc.org')).toBeInTheDocument();
    expect(screen.queryByText('dan@wingmacc.org')).not.toBeInTheDocument();
    expect(screen.queryByText('eli@wingmacc.org')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('dan@wingmacc.org')).toBeInTheDocument();
    expect(screen.getByText('eli@wingmacc.org')).toBeInTheDocument();

    // Filter by Band Members
    await user.click(screen.getByRole('combobox', { name: /filter by role/i }));
    await user.click(await screen.findByRole('option', { name: /^band members$/i }));
    expect(screen.getByText('eli@wingmacc.org')).toBeInTheDocument();
    expect(screen.queryByText('dan@wingmacc.org')).not.toBeInTheDocument();
    expect(screen.queryByText('sarah@wingmacc.org')).not.toBeInTheDocument();

    // Filter by Admins
    await user.click(screen.getByRole('combobox', { name: /filter by role/i }));
    await user.click(await screen.findByRole('option', { name: /^admins$/i }));
    expect(screen.getByText('dan@wingmacc.org')).toBeInTheDocument();
    expect(screen.getByText('sarah@wingmacc.org')).toBeInTheDocument();
    expect(screen.queryByText('eli@wingmacc.org')).not.toBeInTheDocument();
  });

  it('disables role promotion and demotion controls with offline notice when offline', () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderTeamPage([adminOne, adminTwo, memberOne]);

      expect(screen.getByText(/Offline — team role changes are disabled/i)).toBeInTheDocument();
      for (const btn of screen.getAllByRole('button', { name: /demote to member/i })) {
        expect(btn).toBeDisabled();
      }
      expect(screen.getByRole('button', { name: /promote to admin/i })).toBeDisabled();
    } finally {
      onLineSpy.mockRestore();
    }
  });
});
