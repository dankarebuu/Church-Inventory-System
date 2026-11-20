import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@supabase/supabase-js';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import { queryKeys } from '@/lib/queryKeys';
import type { ProfileRecord, PublicInventoryItem, UserRole } from '@/types/database';
import { AppShell } from './AppShell';

const mockUseAuth = vi.fn<() => AuthContextValue>();

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const { mockIsConfigured, mockChannelFn, mockRemoveChannelFn } = vi.hoisted(() => {
  const configured = { value: true };
  const removeChannel = vi.fn(async () => 'ok');
  const channel = vi.fn(() => {
    const ch = {
      on: vi.fn(),
      subscribe: vi.fn((cb?: (status: 'SUBSCRIBED') => void) => {
        cb?.('SUBSCRIBED');
        return ch;
      }),
    };
    ch.on.mockReturnValue(ch);
    return ch;
  });

  return {
    mockIsConfigured: configured,
    mockChannelFn: channel,
    mockRemoveChannelFn: removeChannel,
  };
});

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
  supabase: {
    channel: mockChannelFn,
    removeChannel: mockRemoveChannelFn,
    auth: {
      updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  },
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeAll(() => {
  globalThis.ResizeObserver = MockResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function makeAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    profile: null,
    role: 'guest',
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
    ...overrides,
  };
}

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

function makeProfile(role: 'member' | 'admin'): ProfileRecord {
  return {
    id: 'user-1',
    email: 'dan@wingmacc.org',
    first_name: 'Dan',
    last_name: 'Caleb',
    role,
    created_at: '2026-11-18T00:00:00.000Z',
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-url">{`${location.pathname}${location.search}`}</div>;
}

function renderShell(role: UserRole, authOverrides: Partial<AuthContextValue> = {}, initialUrl = '/dashboard') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const authValue = makeAuthValue({
    role,
    user: role === 'guest' ? null : makeUser(),
    profile: role === 'guest' ? null : makeProfile(role),
    ...authOverrides,
  });
  mockUseAuth.mockReturnValue(authValue);

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <LocationProbe />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<div>Dashboard View</div>} />
            <Route path="/inventory" element={<div>Inventory View</div>} />
            <Route path="/categories" element={<div>Categories View</div>} />
            <Route path="/checklist" element={<div>Checklist View</div>} />
            <Route path="/loans" element={<div>Loans View</div>} />
            <Route path="/activity" element={<div>Activity View</div>} />
            <Route path="/team" element={<div>Team View</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { ...utils, queryClient, authValue };
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.value = true;
  });

  it('filters sidebar navigation items by role across guest, member, and admin', () => {
    const { unmount: unmountGuest } = renderShell('guest');
    const guestSidebar = screen.getByLabelText('Primary sidebar');
    expect(within(guestSidebar).getByText('Dashboard')).toBeInTheDocument();
    expect(within(guestSidebar).getByText('Inventory')).toBeInTheDocument();
    expect(within(guestSidebar).getByText('Categories & Locations')).toBeInTheDocument();
    expect(within(guestSidebar).getByText('Sunday Checklist')).toBeInTheDocument();
    expect(within(guestSidebar).queryByText('Loans & Check-Out')).not.toBeInTheDocument();
    expect(within(guestSidebar).queryByText('Activity Log')).not.toBeInTheDocument();
    expect(within(guestSidebar).queryByText('Team Roles')).not.toBeInTheDocument();
    expect(screen.getByText('View Only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Login/i })).toBeInTheDocument();
    unmountGuest();

    const { unmount: unmountMember } = renderShell('member');
    const memberSidebar = screen.getByLabelText('Primary sidebar');
    expect(within(memberSidebar).getByText('Loans & Check-Out')).toBeInTheDocument();
    expect(within(memberSidebar).getByText('Activity Log')).toBeInTheDocument();
    expect(within(memberSidebar).queryByText('Team Roles')).not.toBeInTheDocument();
    unmountMember();

    renderShell('admin');
    const adminSidebar = screen.getByLabelText('Primary sidebar');
    expect(within(adminSidebar).getByText('Loans & Check-Out')).toBeInTheDocument();
    expect(within(adminSidebar).getByText('Activity Log')).toBeInTheDocument();
    expect(within(adminSidebar).getByText('Team Roles')).toBeInTheDocument();
  });

  it('opens CommandDialog via Ctrl+K, filters pages by role, and navigates to cached inventory items', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderShell('guest');

    const cachedItems: PublicInventoryItem[] = [
      {
        id: 'item-sm58',
        category: 'Microphones',
        category_id: 'cat-1',
        subcategory_id: null,
        item: 'Shure SM58 Dynamic Mic',
        brand: 'Shure',
        qty: 4,
        condition: 'working',
        owner: 'Church',
        location: 'Stage Cabinet',
        location_id: 'loc-1',
        serial: 'SM58-001',
        description: 'Vocal mic',
        image_filename: null,
        remarks: null,
        dateChecked: null,
        checked_at: null,
        qty_on_loan: 0,
        available_qty: 4,
        equipment_type_id: null,
        equipment_type: null,
        min_qty: null,
      },
    ];

    act(() => {
      queryClient.setQueryData(queryKeys.inventory('guest'), cachedItems);
    });

    await user.keyboard('{Control>}k{/Control}');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Dashboard')).toBeInTheDocument();
    expect(within(dialog).queryByText('Team Roles')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Loans & Check-Out')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Shure SM58 Dynamic Mic')).toBeInTheDocument();

    await user.click(within(dialog).getByText('Shure SM58 Dynamic Mic'));

    await waitFor(() => {
      expect(screen.getByTestId('current-url')).toHaveTextContent('/inventory?item=item-sm58');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports theme toggle, guest login button, Realtime status pill, sidebar collapse, and mobile drawer', async () => {
    const user = userEvent.setup();
    mockIsConfigured.value = false;
    const { authValue } = renderShell('guest');

    expect(screen.getByRole('status', { name: /Realtime sync: Offline/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(authValue.toggleTheme).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Login/i }));
    expect(authValue.openAuthModal).toHaveBeenCalledWith('login');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByText('Sunday Checklist'));

    await waitFor(() => {
      expect(screen.getByTestId('current-url')).toHaveTextContent('/checklist');
    });
  });

  it('opens AccountSettingsDialog and invokes signOut from the authenticated user menu', async () => {
    const user = userEvent.setup();
    const { authValue } = renderShell('admin');

    expect(screen.getByRole('status', { name: /Realtime sync: Live Sync/i })).toBeInTheDocument();
    expect(screen.getByText('DC')).toBeInTheDocument();
    expect(screen.getByText('Dan Caleb')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Account Settings' }));

    expect(await screen.findByRole('heading', { name: 'Account Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign Out' }));

    expect(authValue.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not open CommandDialog via Ctrl+K while WelcomeGateway or AuthModal is open', async () => {
    const user = userEvent.setup();
    renderShell('guest', { showGateway: true });

    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('displays Catalog Sync label and refresh tooltip for online Guests while showing Live Sync for staff', () => {
    mockIsConfigured.value = true;
    const { unmount } = renderShell('guest');

    const guestPill = screen.getByRole('status', { name: /Realtime sync: Catalog Sync/i });
    expect(guestPill).toBeInTheDocument();
    expect(guestPill).toHaveAttribute(
      'title',
      expect.stringMatching(/tab focus.*60s/i)
    );
    unmount();

    renderShell('member');
    const memberPill = screen.getByRole('status', { name: /Realtime sync: Live Sync/i });
    expect(memberPill).toBeInTheDocument();
    expect(memberPill).toHaveAttribute('title', expect.stringMatching(/live realtime/i));
  });
});
