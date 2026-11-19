import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { HistoryEntry, UserRole } from '@/types/database';
import { ActivityPage } from './ActivityPage';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseActivityLog = vi.fn();
const mockRestoreDeletedItem = vi.fn();
const mockUndoHistoryEntry = vi.fn();

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/features/activity/useActivityLog', async () => {
  const actual = await vi.importActual<typeof import('@/features/activity/useActivityLog')>(
    '@/features/activity/useActivityLog'
  );
  return {
    ...actual,
    useActivityLog: (enabled: boolean) => mockUseActivityLog(enabled),
  };
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeAuthValue(role: UserRole): AuthContextValue {
  return {
    user: role === 'guest' ? null : ({ id: 'user-1', email: 'dan@wingmacc.org' } as never),
    profile:
      role === 'guest'
        ? null
        : {
            id: 'user-1',
            email: 'dan@wingmacc.org',
            first_name: 'Dan',
            last_name: 'Caleb',
            role,
            created_at: '2026-11-18T00:00:00.000Z',
          },
    role,
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

const sampleEntries: HistoryEntry[] = [
  {
    id: 'h_del',
    action: 'deleted',
    item_id: 'item-1',
    item_data: { id: 'item-1', item: 'Cajon Drum', deleted_at: '2026-11-18T10:00:00.000Z' },
    prev_data: { id: 'item-1', item: 'Cajon Drum', qty: 1 },
    user_email: 'admin@wingmacc.org',
    undone: false,
    timestamp: '2026-11-18T10:00:00.000Z',
  },
  {
    id: 'h_upd',
    action: 'updated',
    item_id: 'item-2',
    item_data: { id: 'item-2', item: 'Shure SM58', condition: 'repair', qty: 3 },
    prev_data: { id: 'item-2', item: 'Shure SM58', condition: 'working', qty: 3 },
    user_email: 'eli@wingmacc.org',
    undone: false,
    timestamp: '2026-11-18T09:00:00.000Z',
  },
  {
    id: 'h_loan',
    action: 'loan',
    item_id: 'item-3',
    item_data: {
      actionType: 'checkout',
      item_id: 'item-3',
      item: 'DI Box',
      borrower_name: 'Joel Santos',
      qty_loaned: 1,
    },
    prev_data: null,
    user_email: 'dan@wingmacc.org',
    undone: false,
    timestamp: '2026-11-18T08:00:00.000Z',
  },
];

function renderActivityPage(role: UserRole) {
  mockUseAuth.mockReturnValue(makeAuthValue(role));
  mockUseActivityLog.mockReturnValue({
    entries: sampleEntries,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    restoreDeletedItem: mockRestoreDeletedItem,
    undoHistoryEntry: mockUndoHistoryEntry,
    isRestoring: false,
    isUndoing: false,
    pendingEntryId: null,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ActivityPage', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = MockResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRestoreDeletedItem.mockResolvedValue(undefined);
    mockUndoHistoryEntry.mockResolvedValue(undefined);
  });

  it('renders searchable and filterable entries in read-only mode for Members without Undo/Restore controls', async () => {
    const user = userEvent.setup();
    renderActivityPage('member');

    expect(mockUseActivityLog).toHaveBeenCalledWith(true);
    expect(screen.getByRole('heading', { name: 'Activity Log' })).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText('Cajon Drum')).toBeInTheDocument();
    expect(screen.getByText('Shure SM58')).toBeInTheDocument();
    expect(screen.getByText(/Joel Santos/i)).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/search by item/i), 'Shure');
    expect(screen.queryByText('Cajon Drum')).not.toBeInTheDocument();
    expect(screen.getByText('Shure SM58')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Cajon Drum')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /filter by action/i }));
    await user.click(await screen.findByRole('option', { name: /^loan$/i }));
    expect(screen.getByText('DI Box')).toBeInTheDocument();
    expect(screen.queryByText('Cajon Drum')).not.toBeInTheDocument();
  });

  it('exposes Restore and Undo buttons for Admins and invokes mutations', async () => {
    const user = userEvent.setup();
    renderActivityPage('admin');

    const delCard = screen.getByTestId('activity-entry-h_del');
    const updCard = screen.getByTestId('activity-entry-h_upd');
    const loanCard = screen.getByTestId('activity-entry-h_loan');

    expect(within(loanCard).queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();

    await user.click(within(delCard).getByRole('button', { name: /restore/i }));
    await waitFor(() => {
      expect(mockRestoreDeletedItem).toHaveBeenCalledWith(sampleEntries[0]);
    });

    await user.click(within(updCard).getByRole('button', { name: /undo/i }));
    await waitFor(() => {
      expect(mockUndoHistoryEntry).toHaveBeenCalledWith(sampleEntries[1]);
    });
  });

  it('renders unknown or null legacy history_log actions safely without crashing', () => {
    mockUseAuth.mockReturnValue(makeAuthValue('member'));
    mockUseActivityLog.mockReturnValue({
      entries: [
        {
          id: 'h_legacy_outlier',
          action: 'legacy_edit' as HistoryEntry['action'],
          item_id: 'item-legacy',
          item_data: { id: 'item-legacy', item: 'Legacy Synth' },
          prev_data: null,
          user_email: 'legacy@wingmacc.org',
          undone: false,
          timestamp: '2026-11-18T07:00:00.000Z',
        },
        {
          id: 'h_null_outlier',
          action: null as unknown as HistoryEntry['action'],
          item_id: null,
          item_data: { item: 'Mystery Cable' },
          prev_data: null,
          user_email: 'legacy@wingmacc.org',
          undone: false,
          timestamp: '2026-11-18T06:00:00.000Z',
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      restoreDeletedItem: mockRestoreDeletedItem,
      undoHistoryEntry: mockUndoHistoryEntry,
      isRestoring: false,
      isUndoing: false,
      pendingEntryId: null,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ActivityPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const legacyCard = screen.getByTestId('activity-entry-h_legacy_outlier');
    expect(within(legacyCard).getByText('Legacy_edit')).toBeInTheDocument();
    expect(within(legacyCard).getByText('Legacy Synth')).toBeInTheDocument();
    expect(within(legacyCard).getByText('Recorded legacy_edit action')).toBeInTheDocument();

    const nullCard = screen.getByTestId('activity-entry-h_null_outlier');
    expect(within(nullCard).getByText('Activity')).toBeInTheDocument();
    expect(within(nullCard).getByText('Mystery Cable')).toBeInTheDocument();
    expect(within(nullCard).getByText('Recorded activity action')).toBeInTheDocument();
  });
});
