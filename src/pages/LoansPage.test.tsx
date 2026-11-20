import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { LoanRecord, UserRole } from '@/types/database';
import { LoansPage } from './LoansPage';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseInventoryItems = vi.fn<(role: UserRole) => {
  data: EnrichedInventoryItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}>();
const mockUseLoans = vi.fn<(enabled: boolean) => {
  loans: LoanRecord[];
  activeLoans: LoanRecord[];
  returnedLoans: LoanRecord[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  checkoutItem: typeof mockCheckoutItem;
  returnLoan: typeof mockReturnLoan;
  isCheckingOut: boolean;
  isReturning: boolean;
}>();
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
  };
});

vi.mock('@/features/loans/useLoans', async () => {
  const actual = await vi.importActual<typeof import('@/features/loans/useLoans')>(
    '@/features/loans/useLoans'
  );
  return {
    ...actual,
    useLoans: (enabled: boolean) => mockUseLoans(enabled),
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

function makeLocalYmdOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const sampleItems: EnrichedInventoryItem[] = [
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
    description: null,
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    checkedBy: 'Dan Caleb',
    qty_on_loan: 1,
    available_qty: 1,
    equipment_type_id: null,
    equipment_type: null,
    min_qty: null,
    activeLoans: [],
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
    location: 'Sound Booth',
    location_id: 'loc-booth',
    serial: 'SM58-01',
    description: null,
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    checkedBy: 'Dan Caleb',
    qty_on_loan: 2,
    available_qty: 2,
    equipment_type_id: null,
    equipment_type: null,
    min_qty: null,
    activeLoans: [],
  },
  {
    id: 'item-all-out',
    category: 'Keyboard',
    category_id: 'cat-kb',
    subcategory_id: null,
    item: 'Nord Stage 4',
    brand: 'Nord',
    qty: 1,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-stage',
    serial: 'NS4-01',
    description: null,
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    checkedBy: 'Dan Caleb',
    qty_on_loan: 1,
    available_qty: 0,
    equipment_type_id: null,
    equipment_type: null,
    min_qty: null,
    activeLoans: [],
  },
];

function makeSampleLoans(): LoanRecord[] {
  return [
    {
      id: 'loan-overdue',
      item_id: 'item-snare',
      borrower_name: 'Joel Santos',
      borrower_contact: '09171234567',
      qty_loaned: 1,
      checked_out_at: '2026-11-10T10:00:00.000Z',
      due_date: makeLocalYmdOffset(-2),
      returned_at: null,
      checked_out_by: 'Dan Caleb',
      returned_by: null,
      notes: 'Youth camp rehearsal',
    },
    {
      id: 'loan-current',
      item_id: 'item-mic',
      borrower_name: 'Mia Reyes',
      borrower_contact: 'mia@wingmacc.org',
      qty_loaned: 2,
      checked_out_at: '2026-11-17T10:00:00.000Z',
      due_date: makeLocalYmdOffset(4),
      returned_at: null,
      checked_out_by: 'Dan Caleb',
      returned_by: null,
      notes: 'Outreach choir',
    },
    {
      id: 'loan-returned',
      item_id: 'item-mic',
      borrower_name: 'Eli Cruz',
      borrower_contact: null,
      qty_loaned: 1,
      checked_out_at: '2026-11-01T10:00:00.000Z',
      due_date: makeLocalYmdOffset(-5),
      returned_at: '2026-11-05T15:00:00.000Z',
      checked_out_by: 'Dan Caleb',
      returned_by: 'Dan Caleb',
      notes: 'Sunday acoustic set',
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

function renderLoansPage(role: UserRole = 'member', loans = makeSampleLoans()) {
  mockUseAuth.mockReturnValue(makeAuthValue(role));
  mockUseInventoryItems.mockReturnValue({
    data: sampleItems,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLoans.mockReturnValue({
    loans,
    activeLoans: loans.filter((l) => l.returned_at == null),
    returnedLoans: loans.filter((l) => l.returned_at != null),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    checkoutItem: mockCheckoutItem,
    returnLoan: mockReturnLoan,
    isCheckingOut: false,
    isReturning: false,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/loans']}>
        <Routes>
          <Route path="/loans" element={<LoansPage />} />
          <Route path="/inventory" element={<div>Inventory Route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoansPage', () => {
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
    mockCheckoutItem.mockResolvedValue({});
    mockReturnLoan.mockResolvedValue({});
  });

  it('renders Active Loans with overdue warning badges, supports Overdue Only toggle, search, and Returned History tab', async () => {
    const user = userEvent.setup();
    renderLoansPage('member');

    expect(mockUseLoans).toHaveBeenCalledWith(true);
    expect(screen.getByRole('heading', { name: /loans & check-out/i })).toBeInTheDocument();

    // Active Loans tab shows both active loans, with Overdue badge only on Joel Santos
    expect(screen.getByText('Joel Santos')).toBeInTheDocument();
    expect(screen.getByText('Mia Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Eli Cruz')).not.toBeInTheDocument();

    const overdueBadges = screen.getAllByText(/^overdue$/i);
    expect(overdueBadges).toHaveLength(1);

    // Overdue Only toggle chip filters down to overdue active loans
    const overdueToggle = screen.getByRole('button', { name: /overdue only/i });
    expect(overdueToggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(overdueToggle);
    expect(overdueToggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Joel Santos')).toBeInTheDocument();
    expect(screen.queryByText('Mia Reyes')).not.toBeInTheDocument();

    // Turn Overdue Only off and test search
    await user.click(overdueToggle);
    expect(screen.getByText('Mia Reyes')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/search by item, borrower/i);
    await user.type(searchInput, 'Mia');
    expect(screen.queryByText('Joel Santos')).not.toBeInTheDocument();
    expect(screen.getByText('Mia Reyes')).toBeInTheDocument();

    await user.clear(searchInput);

    // Switch to Returned History tab
    await user.click(screen.getByRole('tab', { name: /returned history/i }));
    const eliCell = await screen.findByText('Eli Cruz');
    const eliRow = eliCell.closest('tr');
    expect(eliRow).not.toBeNull();
    expect(screen.queryByText('Joel Santos')).not.toBeInTheDocument();
    expect(within(eliRow as HTMLElement).getByText(/^returned$/i)).toBeInTheDocument();
  });

  it('calls returnLoan on one-click Return Gear button', async () => {
    const user = userEvent.setup();
    renderLoansPage('member');

    const joelRow = screen.getByText('Joel Santos').closest('tr');
    expect(joelRow).not.toBeNull();

    await user.click(
      within(joelRow as HTMLElement).getByRole('button', { name: /return gear/i })
    );

    await waitFor(() => {
      expect(mockReturnLoan).toHaveBeenCalledTimes(1);
    });
    expect(mockReturnLoan).toHaveBeenCalledWith(
      expect.objectContaining({
        loan: expect.objectContaining({ id: 'loan-overdue' }),
        itemName: 'Pearl Brass Snare',
      })
    );
  });

  it('opens CheckoutDialog, filters to available items, validates qty bounds, and submits valid check-out', async () => {
    const user = userEvent.setup();
    renderLoansPage('admin');

    await user.click(screen.getByRole('button', { name: /check out gear/i }));
    const dialog = await screen.findByRole('dialog');

    // Open equipment selector — only items with available_qty > 0 appear
    await user.click(within(dialog).getByRole('combobox', { name: /equipment item/i }));
    expect(await screen.findByRole('option', { name: /pearl brass snare/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /shure sm58 mic/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /nord stage 4/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /shure sm58 mic/i }));
    expect(within(dialog).getByText(/available:\s*2\s*\/\s*4/i)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/borrower name/i), '  Pastor Luke  ');
    await user.type(within(dialog).getByLabelText(/borrower contact/i), '09180001111');

    const qtyInput = within(dialog).getByLabelText(/quantity/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '3');

    await user.click(within(dialog).getByRole('button', { name: /confirm check out/i }));
    expect(await within(dialog).findByText(/cannot exceed 2/i)).toBeInTheDocument();
    expect(mockCheckoutItem).not.toHaveBeenCalled();

    await user.clear(qtyInput);
    await user.type(qtyInput, '0');
    await user.click(within(dialog).getByRole('button', { name: /confirm check out/i }));
    expect(await within(dialog).findByText(/at least 1/i)).toBeInTheDocument();
    expect(mockCheckoutItem).not.toHaveBeenCalled();

    await user.clear(qtyInput);
    await user.type(qtyInput, '2');
    await user.type(within(dialog).getByLabelText(/notes/i), 'Sunday evening service');

    await user.click(within(dialog).getByRole('button', { name: /confirm check out/i }));

    await waitFor(() => {
      expect(mockCheckoutItem).toHaveBeenCalledTimes(1);
    });
    expect(mockCheckoutItem).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: 'item-mic',
        itemName: 'Shure SM58 Mic',
        maxAvailableQty: 2,
        borrower_name: 'Pastor Luke',
        borrower_contact: '09180001111',
        qty_loaned: 2,
        notes: 'Sunday evening service',
      })
    );
  });

  it('disables loan queries and action buttons when rendered for Guest role', () => {
    renderLoansPage('guest', []);

    expect(mockUseLoans).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('button', { name: /check out gear/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return gear/i })).not.toBeInTheDocument();
  });

  it('preserves unsaved CheckoutDialog edits across background inventory refetches and surfaces mutation errors', async () => {
    const user = userEvent.setup();
    mockCheckoutItem.mockRejectedValueOnce(new Error('Loan capacity exceeded for item'));

    const { rerender } = renderLoansPage('member');

    await user.click(screen.getByRole('button', { name: /check out gear/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('combobox', { name: /equipment item/i }));
    await user.click(await screen.findByRole('option', { name: /pearl brass snare/i }));

    const borrowerInput = within(dialog).getByLabelText(/borrower name/i) as HTMLInputElement;
    await user.type(borrowerInput, 'Mark Rivera');

    // Simulate background inventory refetch supplying fresh array/object references while dialog stays open
    mockUseInventoryItems.mockReturnValue({
      data: sampleItems.map((entry) => ({ ...entry })),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const freshClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={freshClient}>
        <MemoryRouter initialEntries={['/loans']}>
          <Routes>
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/inventory" element={<div>Inventory Route</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(
      (within(screen.getByRole('dialog')).getByLabelText(/borrower name/i) as HTMLInputElement)
        .value
    ).toBe('Mark Rivera');

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /confirm check out/i })
    );
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      /loan capacity exceeded/i
    );
  });
});
