import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, LocationRecord, UserRole } from '@/types/database';
import { InventoryPage, VIEW_MODE_STORAGE_KEY } from './InventoryPage';

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
const mockSoftDeleteItem = vi.fn();
const mockSaveItem = vi.fn();
const mockCheckoutItem = vi.fn();
const mockReturnLoan = vi.fn();

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
      saveItem: mockSaveItem,
      softDeleteItem: mockSoftDeleteItem,
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

vi.mock('@/features/loans/useLoans', async () => {
  const actual = await vi.importActual<typeof import('@/features/loans/useLoans')>(
    '@/features/loans/useLoans'
  );
  return {
    ...actual,
    useLoanMutations: () => ({
      checkoutItem: mockCheckoutItem,
      returnLoan: mockReturnLoan,
      isCheckingOut: false,
      isReturning: false,
    }),
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
  const baseItems: EnrichedInventoryItem[] = [
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
      image_filename: '["https://cdn.example.com/snare.jpg"]',
      remarks: 'Tuned for Sunday',
      dateChecked: 'November 18, 2026',
      checked_at: '2026-11-18T09:00:00.000Z',
      qty_on_loan: 1,
      available_qty: 1,
    },
    {
      id: 'item-cable',
      category: 'Spares & Shared',
      category_id: 'cat-spares',
      subcategory_id: null,
      item: 'Mogami XLR Cable',
      brand: 'Mogami',
      qty: 4,
      condition: 'repair',
      owner: 'Church Property',
      location: 'Booth',
      location_id: 'loc-booth',
      serial: 'XLR-04',
      description: '20ft XLR balanced mic cable',
      image_filename: null,
      remarks: 'Needs solder on pin 2',
      dateChecked: 'November 17, 2026',
      checked_at: '2026-11-17T09:00:00.000Z',
      qty_on_loan: 0,
      available_qty: 4,
    },
  ];

  if (role === 'guest') {
    return baseItems;
  }

  return [
    {
      ...baseItems[0],
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
      ...baseItems[1],
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

function renderInventoryPage(role: UserRole, initialEntry = '/inventory') {
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
          <Route path="/inventory" element={<InventoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('InventoryPage', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = MockResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    Element.prototype.scrollIntoView = originalScrollIntoView;
    Element.prototype.hasPointerCapture = originalHasPointerCapture;
    Element.prototype.setPointerCapture = originalSetPointerCapture;
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockMemberCheckItem.mockResolvedValue({
      id: 'item-snare',
      condition: 'repair',
      checkedBy: 'Dan Caleb',
      dateChecked: 'November 18, 2026',
      checked_at: '2026-11-18T10:00:00.000Z',
      remarks: null,
      action: 'updated',
    });
    mockSoftDeleteItem.mockResolvedValue(undefined);
    mockSaveItem.mockResolvedValue({});
    mockCheckoutItem.mockResolvedValue({});
    mockReturnLoan.mockResolvedValue({});
  });

  it('enforces Guest privacy & read-only controls while showing available_qty / qty and anonymous On Loan badge', async () => {
    const user = userEvent.setup();
    renderInventoryPage('guest');

    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('On Loan')).toBeInTheDocument();

    // Guest must never see borrower PII, checkedBy, quick checks, or CRUD/Checkout controls
    expect(screen.queryByText(/Joel Santos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dan Caleb/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^export$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ok$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^fix$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^lost$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trash|delete/i })).not.toBeInTheDocument();

    // Open ItemDetailDrawer for snare
    await user.click(screen.getByText('Pearl Brass Snare'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Main worship snare')).toBeInTheDocument();
    expect(within(drawer).queryByText(/Joel Santos/i)).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /check out/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it('shows quick OK/Fix/Lost checks and active loans + Check Out for Member without Admin Add/Edit/Trash', async () => {
    const user = userEvent.setup();
    renderInventoryPage('member');

    expect(screen.queryByRole('button', { name: /add item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^export$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trash|delete/i })).not.toBeInTheDocument();

    const fixButtons = screen.getAllByRole('button', { name: /^fix$/i });
    expect(fixButtons.length).toBeGreaterThan(0);

    await user.click(fixButtons[0]);
    expect(mockMemberCheckItem).toHaveBeenCalledWith({
      itemId: 'item-snare',
      condition: 'repair',
    });

    // Open ItemDetailDrawer and verify borrower details + Check Out + Return wiring
    await user.click(screen.getByText('Pearl Brass Snare'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/Joel Santos/i)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /check out/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /^return$/i })).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /trash|delete/i })).not.toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: /^return$/i }));
    await waitFor(() => {
      expect(mockReturnLoan).toHaveBeenCalledTimes(1);
    });
    expect(mockReturnLoan).toHaveBeenCalledWith(
      expect.objectContaining({
        loan: expect.objectContaining({ id: 'loan-1' }),
        itemName: 'Pearl Brass Snare',
      })
    );

    await user.click(within(drawer).getByRole('button', { name: /check out/i }));
    const checkoutDialog = await screen.findByRole('dialog', { name: /check out gear/i });
    expect(within(checkoutDialog).getByText(/available:\s*1\s*\/\s*2/i)).toBeInTheDocument();
    await user.type(within(checkoutDialog).getByLabelText(/borrower name/i), 'Sam Lee');
    await user.click(within(checkoutDialog).getByRole('button', { name: /confirm check out/i }));

    await waitFor(() => {
      expect(mockCheckoutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          item_id: 'item-snare',
          itemName: 'Pearl Brass Snare',
          borrower_name: 'Sam Lee',
          qty_loaned: 1,
        })
      );
    });
  });

  it('provides Admin Add, Edit, and AlertDialog-confirmed Trash actions', async () => {
    const user = userEvent.setup();
    renderInventoryPage('admin');

    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^export$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument();

    // Clicking Import launches the Header-Mapped ImportWizardDialog
    await user.click(screen.getByRole('button', { name: /^import$/i }));
    expect(await screen.findByRole('dialog', { name: /import equipment data/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /import equipment data/i })).not.toBeInTheDocument();
    });

    // Export menu exposes CSV & JSON options
    await user.click(screen.getByRole('button', { name: /^export$/i }));
    expect(await screen.findByRole('menuitem', { name: /export csv/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /export json backup/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    const trashButtons = screen.getAllByRole('button', { name: /trash|delete/i });
    expect(editButtons.length).toBeGreaterThan(0);
    expect(trashButtons.length).toBeGreaterThan(0);

    await user.click(trashButtons[0]);
    const alertDialog = await screen.findByRole('alertdialog');
    expect(within(alertDialog).getByText(/Pearl Brass Snare/i)).toBeInTheDocument();

    await user.click(within(alertDialog).getByRole('button', { name: /move to trash|confirm|delete/i }));
    await waitFor(() => {
      expect(mockSoftDeleteItem).toHaveBeenCalledTimes(1);
    });

    // Opening ItemDetailDrawer and clicking Edit launches ItemFormDialog cleanly
    await user.click(screen.getByText('Pearl Brass Snare'));
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: /^edit$/i }));
    const editHeading = await screen.findByRole('heading', { name: /edit equipment item/i });
    expect(editHeading).toBeInTheDocument();
    const qtyInput = screen.getByLabelText(/quantity/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '0');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(mockSaveItem).toHaveBeenCalledTimes(1);
    });
    expect(mockSaveItem.mock.calls[0][0].values.qty).toBe(0);
  });

  it('toggles between Color-Band Grid and TanStack Table views with localStorage persistence and filters via URL params', async () => {
    const user = userEvent.setup();
    renderInventoryPage('guest', '/inventory?item=item-snare');

    // Deep-linked ?item= opens ItemDetailDrawer automatically
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Main worship snare')).toBeInTheDocument();

    // Clicking photo opens ZoomLightbox; Escape closes Lightbox without closing Drawer
    await user.click(screen.getByRole('button', { name: /open full preview of pearl brass snare/i }));
    const lightbox = await screen.findByRole('dialog', { name: /lightbox preview/i });
    expect(lightbox).toBeInTheDocument();

    await user.click(within(lightbox).getByRole('button', { name: /zoom in/i }));
    expect(within(lightbox).getByText('250%')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /lightbox preview/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Main worship snare')).toBeInTheDocument();

    // Second Escape closes the drawer
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Grid view renders .band left borders and collapsible category headers
    expect(document.querySelectorAll('.band').length).toBeGreaterThan(0);
    const drumsHeaderBtn = screen.getByRole('button', { name: /drums/i });
    expect(drumsHeaderBtn).toHaveAttribute('aria-expanded', 'true');
    await user.click(drumsHeaderBtn);
    expect(drumsHeaderBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Pearl Brass Snare')).not.toBeInTheDocument();
    await user.click(drumsHeaderBtn);
    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();

    // Switch to Table View and confirm persistence + sorting
    await user.click(screen.getByRole('button', { name: /table/i }));
    expect(localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe('table');
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    const itemHeaderBtn = within(table).getByRole('button', { name: /^item$/i });
    await user.click(itemHeaderBtn);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Mogami XLR Cable');

    // Switch back to Grid View
    await user.click(screen.getByRole('button', { name: /grid/i }));
    expect(localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe('grid');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    // Search filter narrows results and Clear Filters restores all items
    const searchInput = screen.getByPlaceholderText(/search equipment/i);
    await user.type(searchInput, 'Mogami');
    expect(screen.queryByText('Pearl Brass Snare')).not.toBeInTheDocument();
    expect(screen.getByText('Mogami XLR Cable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(screen.getByText('Mogami XLR Cable')).toBeInTheDocument();
  });

  it('pre-filters via URL params (?category=...) and supports multi-facet condition & loan filters', async () => {
    const user = userEvent.setup();
    renderInventoryPage('guest', '/inventory?category=cat-drums');

    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(screen.queryByText('Mogami XLR Cable')).not.toBeInTheDocument();

    // Subcategory dropdown activates when a parent category with subcategories is active
    const subTrigger = screen.getByRole('combobox', { name: /filter by subcategory/i });
    expect(subTrigger).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Mogami XLR Cable')).toBeInTheDocument();

    // Condition "Flagged" shows only repair/missing items
    await user.click(screen.getByRole('combobox', { name: /filter by condition/i }));
    await user.click(await screen.findByRole('option', { name: /flagged/i }));
    expect(screen.queryByText('Pearl Brass Snare')).not.toBeInTheDocument();
    expect(screen.getByText('Mogami XLR Cable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));

    // Loan "On Loan" shows only loaned items
    await user.click(screen.getByRole('combobox', { name: /filter by loan status/i }));
    await user.click(await screen.findByRole('option', { name: /^on loan$/i }));
    expect(screen.getByText('Pearl Brass Snare')).toBeInTheDocument();
    expect(screen.queryByText('Mogami XLR Cable')).not.toBeInTheDocument();
  });

  it('prefers local checked_at over stale UTC dateChecked in InventoryGrid and ItemDetailDrawer while falling back for legacy items', async () => {
    const user = userEvent.setup();
    const localMorning = new Date(2026, 10, 15, 2, 0, 0);

    mockUseAuth.mockReturnValue(makeAuthValue('member'));
    mockUseInventoryItems.mockReturnValue({
      data: [
        {
          ...makeSampleItems('member')[0],
          id: 'item-tz-priority',
          item: 'TZ Test Snare',
          dateChecked: 'November 14, 2026',
          checked_at: localMorning.toISOString(),
        },
        {
          ...makeSampleItems('member')[1],
          id: 'item-legacy-fallback',
          item: 'Legacy Fallback Cable',
          dateChecked: 'Legacy Checkoff',
          checked_at: null,
        },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseCategories.mockReturnValue({ data: sampleCategories, isLoading: false });
    mockUseLocations.mockReturnValue({ data: sampleLocations, isLoading: false });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/inventory']}>
          <Routes>
            <Route path="/inventory" element={<InventoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByText(/Checked November 15, 2026/i)).toBeInTheDocument();
    expect(screen.queryByText(/Checked November 14, 2026/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Checked Legacy Checkoff/i)).toBeInTheDocument();

    await user.click(screen.getByText('TZ Test Snare'));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('November 15, 2026')).toBeInTheDocument();
    expect(within(drawer).queryByText(/November 14, 2026/i)).not.toBeInTheDocument();
  });
});
