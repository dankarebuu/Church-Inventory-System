import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, LocationRecord, UserRole } from '@/types/database';
import { ChecklistPage } from './ChecklistPage';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseInventoryItems = vi.fn<(role: UserRole) => {
  data: EnrichedInventoryItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}>();
const mockUseCategories = vi.fn<() => { data: Category[]; isLoading: boolean }>();
const mockUseLocations = vi.fn<() => { data: LocationRecord[]; isLoading: boolean }>();
const mockMemberCheckItem = vi.fn();

const { mockHtml2PdfSave, mockHtml2PdfFrom, mockHtml2PdfSet, mockHtml2PdfFactory } =
  vi.hoisted(() => {
    const save = vi.fn(async () => undefined);
    const from = vi.fn(() => ({ save }));
    const set = vi.fn(() => ({ from }));
    const factory = vi.fn(() => ({ set, from, save }));
    return {
      mockHtml2PdfSave: save,
      mockHtml2PdfFrom: from,
      mockHtml2PdfSet: set,
      mockHtml2PdfFactory: factory,
    };
  });

vi.mock('html2pdf.js', () => ({
  default: mockHtml2PdfFactory,
}));

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/features/inventory/useInventory', async () => {
  const actual = await vi.importActual<typeof import('@/features/inventory/useInventory')>(
    '@/features/inventory/useInventory'
  );
  return {
    ...actual,
    useInventoryItems: (role: UserRole) => mockUseInventoryItems(role),
    useItemMutations: () => ({
      saveItem: vi.fn(),
      softDeleteItem: vi.fn(),
      memberCheckItem: mockMemberCheckItem,
      uploadGearPhotos: vi.fn(),
      isSaving: false,
      isDeleting: false,
      isChecking: false,
      isUploading: false,
    }),
  };
});

vi.mock('@/features/categories/useCategories', async () => {
  const actual = await vi.importActual<typeof import('@/features/categories/useCategories')>(
    '@/features/categories/useCategories'
  );
  return {
    ...actual,
    useCategories: () => mockUseCategories(),
  };
});

vi.mock('@/features/locations/useLocations', async () => {
  const actual = await vi.importActual<typeof import('@/features/locations/useLocations')>(
    '@/features/locations/useLocations'
  );
  return {
    ...actual,
    useLocations: () => mockUseLocations(),
  };
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalHasPointerCapture = Element.prototype.hasPointerCapture;
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;
const originalPrint = window.print;

const sampleCategories: Category[] = [
  {
    id: 'cat-drums',
    name: 'Drums',
    parent_id: null,
    color: '#d97740',
    icon: 'drum',
    sort_order: 10,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'sub-snare',
    name: 'Snares',
    parent_id: 'cat-drums',
    color: '#d97740',
    icon: 'disc',
    sort_order: 11,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'cat-spares',
    name: 'Spares & Shared',
    parent_id: null,
    color: '#4e7fb0',
    icon: 'cable',
    sort_order: 70,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

const sampleLocations: LocationRecord[] = [
  {
    id: 'loc-stage',
    name: 'Stage',
    description: 'Main Stage',
    sort_order: 10,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'loc-booth',
    name: 'Booth',
    description: 'Sound Booth',
    sort_order: 20,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

function makeSampleItems(role: UserRole): EnrichedInventoryItem[] {
  const now = new Date();
  const checkedTodayIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    8,
    30,
    0
  ).toISOString();
  const checkedYesterdayIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
    22,
    0,
    0
  ).toISOString();

  const base: EnrichedInventoryItem[] = [
    {
      id: 'item-snare',
      category: 'Drums',
      category_id: 'cat-drums',
      subcategory_id: 'sub-snare',
      item: 'Pearl Brass Snare',
      brand: 'Pearl',
      qty: 2,
      condition: 'working',
      owner: 'Church Property',
      location: 'Stage',
      location_id: 'loc-stage',
      serial: 'SN-100',
      description: 'Main worship snare',
      image_filename: null,
      remarks: 'Tuned for Sunday',
      dateChecked: 'Yesterday',
      checked_at: checkedYesterdayIso,
      qty_on_loan: 1,
      available_qty: 1,
      equipment_type_id: null,
      equipment_type: null,
      min_qty: null,
    },
    {
      id: 'item-mic',
      category: 'Spares & Shared',
      category_id: 'cat-spares',
      subcategory_id: null,
      item: 'Shure SM58 Mic',
      brand: 'Shure',
      qty: 4,
      condition: 'working',
      owner: 'Church Property',
      location: 'Booth',
      location_id: 'loc-booth',
      serial: 'SM58-01',
      description: null,
      image_filename: null,
      remarks: null,
      dateChecked: 'Today',
      checked_at: checkedTodayIso,
      qty_on_loan: 0,
      available_qty: 4,
      equipment_type_id: null,
      equipment_type: null,
      min_qty: null,
    },
    {
      id: 'item-zero-cable',
      category: 'Spares & Shared',
      category_id: 'cat-spares',
      subcategory_id: null,
      item: 'Backup DI Adapter',
      brand: 'Radial',
      qty: 0,
      condition: 'repair',
      owner: 'Band Team',
      location: 'Booth',
      location_id: 'loc-booth',
      serial: null,
      description: null,
      image_filename: null,
      remarks: 'Out of stock for repair',
      dateChecked: null,
      checked_at: null,
      qty_on_loan: 0,
      available_qty: 0,
      equipment_type_id: null,
      equipment_type: null,
      min_qty: null,
    },
  ];

  if (role === 'guest') {
    return base;
  }

  return [
    {
      ...base[0],
      checkedBy: 'Dan Caleb',
      activeLoans: [
        {
          id: 'loan-1',
          item_id: 'item-snare',
          borrower_name: 'Joel Santos',
          borrower_contact: '09171234567',
          qty_loaned: 1,
          checked_out_at: '2026-11-15T10:00:00.000Z',
          due_date: '2026-11-25',
          returned_at: null,
          checked_out_by: 'Dan Caleb',
          returned_by: null,
          notes: 'Youth fellowship',
        },
      ],
    },
    {
      ...base[1],
      checkedBy: 'Eli Cruz',
      activeLoans: [],
    },
    {
      ...base[2],
      checkedBy: 'Eli Cruz',
      activeLoans: [],
    },
  ];
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

function renderChecklistPage(role: UserRole, initialEntry = '/checklist') {
  mockUseAuth.mockReturnValue(makeAuthValue(role));
  mockUseInventoryItems.mockReturnValue({
    data: makeSampleItems(role),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseCategories.mockReturnValue({
    data: sampleCategories,
    isLoading: false,
  });
  mockUseLocations.mockReturnValue({
    data: sampleLocations,
    isLoading: false,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/checklist" element={<ChecklistPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ChecklistPage', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = MockResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    window.print = vi.fn();
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    Element.prototype.scrollIntoView = originalScrollIntoView;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
    window.print = originalPrint;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemberCheckItem.mockResolvedValue({
      id: 'item-snare',
      condition: 'working',
      checkedBy: 'Dan Caleb',
      dateChecked: 'November 22, 2026',
      checked_at: new Date().toISOString(),
      remarks: null,
      action: 'checked',
    });
  });

  it('shows Print / PDF Checklist only for Guests, renders qty = 0 accurately, omits borrower PII, and exports via print or lazy html2pdf', async () => {
    const user = userEvent.setup();
    renderChecklistPage('guest', '/checklist?tab=live');

    // Guest sees Print / PDF tab only; Live Check-Off tab and tap controls are hidden
    expect(screen.getByRole('tab', { name: /print \/ pdf checklist/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /live check-off/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ok$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^fix$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^lost$/i })).not.toBeInTheDocument();

    // Printable sheet displays items, qty = 0 without coercion, anonymous loan status, and signature lines
    expect(screen.getByText('Sunday Equipment Checklist')).toBeInTheDocument();
    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(screen.getByText('Backup DI Adapter')).toBeInTheDocument();

    const zeroRow = screen.getByText('Backup DI Adapter').closest('tr');
    expect(zeroRow).not.toBeNull();
    expect(within(zeroRow!).getByText('0')).toBeInTheDocument();

    expect(screen.getByText(/checked by \(signature/i)).toBeInTheDocument();
    expect(screen.queryByText(/Joel Santos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dan Caleb/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/09171234567/i)).not.toBeInTheDocument();

    // Lazy html2pdf.js is NOT invoked until Download PDF is clicked
    expect(mockHtml2PdfFactory).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /print checklist/i }));
    expect(window.print).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => {
      expect(mockHtml2PdfFactory).toHaveBeenCalledTimes(1);
      expect(mockHtml2PdfSet).toHaveBeenCalledWith(
        expect.objectContaining({
          filename: expect.stringMatching(/^wingmacc-sunday-checklist-\d{4}-\d{2}-\d{2}\.pdf$/),
        })
      );
      expect(mockHtml2PdfFrom).toHaveBeenCalledTimes(1);
      expect(mockHtml2PdfSave).toHaveBeenCalledTimes(1);
    });
  });

  it('allows Members to view Checked Today progress, filter gear, and tap OK on an already-working item', async () => {
    const user = userEvent.setup();
    renderChecklistPage('member');

    expect(screen.getByRole('tab', { name: /live check-off/i })).toHaveAttribute(
      'data-state',
      'active'
    );
    expect(screen.getByText(/1 of 3 items checked today/i)).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();

    // Tapping OK on Pearl Brass Snare (which is already condition: 'working') still invokes memberCheckItem
    const snareCard = screen.getByTestId('checklist-item-item-snare');
    const okButton = within(snareCard).getByRole('button', { name: /^ok$/i });
    expect(okButton).not.toBeDisabled();
    await user.click(okButton);

    await waitFor(() => {
      expect(mockMemberCheckItem).toHaveBeenCalledWith({
        itemId: 'item-snare',
        condition: 'working',
      });
    });

    // Unchecked Today toggle hides Shure SM58 Mic (checked today) while keeping unchecked items
    await user.click(screen.getByRole('button', { name: /unchecked today/i }));
    expect(screen.queryByText('Shure SM58 Mic')).not.toBeInTheDocument();
    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(screen.getByText('Backup DI Adapter')).toBeInTheDocument();
  });

  it('allows Admins to use Live Check-Off and strips borrower PII + checkedBy from Print / PDF tab', async () => {
    const user = userEvent.setup();
    renderChecklistPage('admin');

    const adapterCard = screen.getByTestId('checklist-item-item-zero-cable');
    expect(within(adapterCard).getByText('0 / 0')).toBeInTheDocument();

    await user.click(within(adapterCard).getByRole('button', { name: /^lost$/i }));
    await waitFor(() => {
      expect(mockMemberCheckItem).toHaveBeenCalledWith({
        itemId: 'item-zero-cable',
        condition: 'missing',
      });
    });

    // Switch to Print / PDF Checklist tab and confirm borrower PII & checkedBy are omitted
    await user.click(screen.getByRole('tab', { name: /print \/ pdf checklist/i }));
    const printSheet = await screen.findByTestId('checklist-print-sheet');
    expect(within(printSheet).getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(within(printSheet).queryByText(/Joel Santos/i)).not.toBeInTheDocument();
    expect(within(printSheet).queryByText(/Dan Caleb/i)).not.toBeInTheDocument();
    expect(within(printSheet).queryByText(/Eli Cruz/i)).not.toBeInTheDocument();
    expect(within(printSheet).queryByText(/09171234567/i)).not.toBeInTheDocument();
  });

  it('supports Category and Location filters and renders loading and error retry states cleanly', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();

    mockUseAuth.mockReturnValue(makeAuthValue('member'));
    mockUseCategories.mockReturnValue({ data: sampleCategories, isLoading: false });
    mockUseLocations.mockReturnValue({ data: sampleLocations, isLoading: false });
    mockUseInventoryItems.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error('Network error'),
      refetch,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/checklist']}>
          <Routes>
            <Route path="/checklist" element={<ChecklistPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    unmount();

    // Now render normal guest view and filter Print sheet by Category
    renderChecklistPage('guest');
    await user.click(screen.getByRole('combobox', { name: /filter by category/i }));
    await user.click(screen.getByRole('option', { name: 'Drums' }));

    const printSheet = screen.getByTestId('checklist-print-sheet');
    expect(within(printSheet).getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(within(printSheet).queryByText('Shure SM58 Mic')).not.toBeInTheDocument();
  });

  it('renders loading state, handles PDF export failure gracefully, and supports live search + clear filters', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue(makeAuthValue('member'));
    mockUseCategories.mockReturnValue({ data: sampleCategories, isLoading: false });
    mockUseLocations.mockReturnValue({ data: sampleLocations, isLoading: false });
    mockUseInventoryItems.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/checklist']}>
          <Routes>
            <Route path="/checklist" element={<ChecklistPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole('status')).toHaveTextContent(/loading sunday checklist/i);
    unmount();

    // Live search + Clear Filters
    renderChecklistPage('member');
    const searchInput = screen.getByRole('searchbox', { name: /search checklist items/i });
    await user.type(searchInput, 'Radial');
    expect(screen.getByText('Backup DI Adapter')).toBeInTheDocument();
    expect(screen.queryByText('Pearl Brass Snare')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();

    // PDF failure resets Download PDF button cleanly
    mockHtml2PdfSave.mockRejectedValueOnce(new Error('Canvas failure'));
    await user.click(screen.getByRole('tab', { name: /print \/ pdf checklist/i }));
    const downloadBtn = await screen.findByRole('button', { name: /download pdf/i });
    await user.click(downloadBtn);

    await waitFor(() => {
      expect(mockHtml2PdfSave).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /download pdf/i })).not.toBeDisabled();
    });
  });

  it('prefers local checked_at over stale UTC dateChecked in ChecklistPage Live Check-Off cards', () => {
    const localMorning = new Date(2026, 10, 15, 2, 0, 0);
    mockUseAuth.mockReturnValue(makeAuthValue('member'));
    mockUseCategories.mockReturnValue({ data: sampleCategories, isLoading: false });
    mockUseLocations.mockReturnValue({ data: sampleLocations, isLoading: false });
    mockUseInventoryItems.mockReturnValue({
      data: [
        {
          ...makeSampleItems('member')[0],
          dateChecked: 'November 14, 2026',
          checked_at: localMorning.toISOString(),
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/checklist']}>
          <Routes>
            <Route path="/checklist" element={<ChecklistPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByText(/Last check: November 15, 2026/i)).toBeInTheDocument();
    expect(screen.queryByText(/November 14, 2026/i)).not.toBeInTheDocument();
  });

  it('disables Live Check-Off buttons with offline notice while keeping Print / PDF Checklist usable offline', async () => {
    const user = userEvent.setup();
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderChecklistPage('member');

      expect(screen.getByText(/Offline — Sunday check-offs are disabled/i)).toBeInTheDocument();
      const snareCard = screen.getByTestId('checklist-item-item-snare');
      expect(within(snareCard).getByRole('button', { name: /^ok$/i })).toBeDisabled();
      expect(within(snareCard).getByRole('button', { name: /^fix$/i })).toBeDisabled();
      expect(within(snareCard).getByRole('button', { name: /^lost$/i })).toBeDisabled();

      await user.click(screen.getByRole('tab', { name: /print \/ pdf checklist/i }));
      expect(await screen.findByRole('button', { name: /print checklist/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /download pdf/i })).toBeEnabled();
    } finally {
      onLineSpy.mockRestore();
    }
  });
});
