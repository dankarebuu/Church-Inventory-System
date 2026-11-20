import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type {
  Category,
  EquipmentType,
  HistoryEntry,
  LoanRecord,
  UserRole,
} from '@/types/database';
import { DashboardPage } from './DashboardPage';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseInventoryItems = vi.fn<(role: UserRole) => {
  data: EnrichedInventoryItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}>();
const mockUseCategories = vi.fn<() => {
  data: Category[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}>();
const mockUseEquipmentTypes = vi.fn<() => {
  data: EquipmentType[];
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
}>();
const mockUseActivityLog = vi.fn<(enabled: boolean) => {
  entries: HistoryEntry[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}>();

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

vi.mock('@/features/categories/useCategories', async () => {
  const actual = await vi.importActual<typeof import('@/features/categories/useCategories')>(
    '@/features/categories/useCategories'
  );
  return {
    ...actual,
    useCategories: () => mockUseCategories(),
  };
});

vi.mock('@/features/equipmentTypes/useEquipmentTypes', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/equipmentTypes/useEquipmentTypes')
  >('@/features/equipmentTypes/useEquipmentTypes');
  return {
    ...actual,
    useEquipmentTypes: () => mockUseEquipmentTypes(),
  };
});

vi.mock('@/features/loans/useLoans', async () => {
  const actual = await vi.importActual<typeof import('@/features/loans/useLoans')>(
    '@/features/loans/useLoans'
  );
  return {
    ...actual,
    useLoans: (enabled: boolean) => mockUseLoans(enabled),
  };
});

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

const originalResizeObserver = globalThis.ResizeObserver;

function makeLocalYmdOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
    sort_order: 20,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'cat-kb',
    name: 'Keyboard',
    parent_id: null,
    color: '#4fa8a0',
    icon: 'piano',
    sort_order: 30,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

const sampleEquipmentTypes: EquipmentType[] = [
  {
    id: 'et-inst',
    name: 'Instruments',
    color: '#2563EB',
    icon: 'guitar',
    sort_order: 10,
    created_at: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'et-di',
    name: 'DI Boxes & Effects',
    color: '#e8a33d',
    icon: 'sliders',
    sort_order: 20,
    created_at: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'et-cables',
    name: 'Cables & Cords',
    color: '#4e7fb0',
    icon: 'cable',
    sort_order: 30,
    created_at: '2026-11-20T00:00:00.000Z',
  },
];

function makeSampleItems(role: UserRole): EnrichedInventoryItem[] {
  const isStaff = role !== 'guest';
  return [
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
      remarks: 'Main snare',
      dateChecked: 'November 18, 2026',
      checked_at: '2026-11-18T09:00:00.000Z',
      ...(isStaff ? { checkedBy: 'Dan Caleb' } : {}),
      qty_on_loan: 1,
      available_qty: 1,
      equipment_type_id: 'et-inst',
      equipment_type: 'Instruments',
      min_qty: 1,
      ...(isStaff ? { activeLoans: [] } : {}),
    },
    {
      id: 'item-di',
      category: 'Spares & Shared',
      category_id: 'cat-spares',
      subcategory_id: null,
      item: 'Radial J48 DI Box',
      brand: 'Radial',
      qty: 4,
      condition: 'repair',
      owner: 'Church Property',
      location: 'Sound Booth',
      location_id: 'loc-booth',
      serial: 'RJ48-01',
      description: null,
      image_filename: null,
      remarks: 'Pad switch crackles when pressed',
      dateChecked: 'November 18, 2026',
      checked_at: '2026-11-18T09:00:00.000Z',
      ...(isStaff ? { checkedBy: 'Eli Cruz' } : {}),
      qty_on_loan: 2,
      available_qty: 2,
      equipment_type_id: 'et-di',
      equipment_type: 'DI Boxes & Effects',
      min_qty: 4,
      ...(isStaff ? { activeLoans: [] } : {}),
    },
    {
      id: 'item-cable-zero',
      category: 'Spares & Shared',
      category_id: 'cat-spares',
      subcategory_id: null,
      item: 'XLR Spare Loom',
      brand: 'Mogami',
      qty: 0,
      condition: 'missing',
      owner: 'Church Property',
      location: 'Storage Closet',
      location_id: 'loc-closet',
      serial: null,
      description: null,
      image_filename: null,
      remarks: 'Needs recount before Sunday',
      dateChecked: 'November 15, 2026',
      checked_at: '2026-11-15T09:00:00.000Z',
      ...(isStaff ? { checkedBy: 'Dan Caleb' } : {}),
      qty_on_loan: 0,
      available_qty: 0,
      equipment_type_id: 'et-cables',
      equipment_type: 'Cables & Cords',
      min_qty: 2,
      ...(isStaff ? { activeLoans: [] } : {}),
    },
    {
      id: 'item-nord',
      category: 'Keyboard',
      category_id: null,
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
      ...(isStaff ? { checkedBy: 'Dan Caleb' } : {}),
      qty_on_loan: 0,
      available_qty: 1,
      equipment_type_id: 'et-inst',
      equipment_type: 'Instruments',
      min_qty: null,
      ...(isStaff ? { activeLoans: [] } : {}),
    },
  ];
}

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
      item_id: 'item-di',
      borrower_name: 'Mia Reyes',
      borrower_contact: 'mia@wingmacc.org',
      qty_loaned: 2,
      checked_out_at: '2026-11-17T10:00:00.000Z',
      due_date: makeLocalYmdOffset(5),
      returned_at: null,
      checked_out_by: 'Dan Caleb',
      returned_by: null,
      notes: 'Outreach choir',
    },
    {
      id: 'loan-returned',
      item_id: 'item-nord',
      borrower_name: 'Returned Borrower Hidden',
      borrower_contact: null,
      qty_loaned: 1,
      checked_out_at: '2026-11-01T10:00:00.000Z',
      due_date: makeLocalYmdOffset(-4),
      returned_at: '2026-11-03T12:00:00.000Z',
      checked_out_by: 'Dan Caleb',
      returned_by: 'Dan Caleb',
      notes: 'Completed loan',
    },
  ];
}

const sampleHistory: HistoryEntry[] = [
  {
    id: 'h-1',
    action: 'checked',
    item_id: 'item-snare',
    item_data: { id: 'item-snare', item: 'Pearl Brass Snare', condition: 'working' },
    prev_data: { id: 'item-snare', item: 'Pearl Brass Snare', condition: 'working' },
    user_email: 'dan@wingmacc.org',
    undone: false,
    timestamp: '2026-11-18T11:00:00.000Z',
  },
  {
    id: 'h-2',
    action: 'updated',
    item_id: 'item-di',
    item_data: { id: 'item-di', item: 'Radial J48 DI Box', condition: 'repair' },
    prev_data: { id: 'item-di', item: 'Radial J48 DI Box', condition: 'working' },
    user_email: 'eli@wingmacc.org',
    undone: false,
    timestamp: '2026-11-18T09:30:00.000Z',
  },
];

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

function RouteEcho() {
  const location = useLocation();
  return <div data-testid="route-echo">{`${location.pathname}${location.search}`}</div>;
}

interface RenderOptions {
  role?: UserRole;
  items?: EnrichedInventoryItem[];
  categories?: Category[];
  equipmentTypes?: EquipmentType[];
  loans?: LoanRecord[];
  history?: HistoryEntry[];
  inventoryError?: Error | null;
  loansError?: Error | null;
  activityError?: Error | null;
  refetchInventory?: () => void;
  refetchLoans?: () => void;
  refetchActivity?: () => void;
}

function renderDashboard({
  role = 'guest',
  items,
  categories = sampleCategories,
  equipmentTypes = sampleEquipmentTypes,
  loans = makeSampleLoans(),
  history = sampleHistory,
  inventoryError = null,
  loansError = null,
  activityError = null,
  refetchInventory = vi.fn(),
  refetchLoans = vi.fn(),
  refetchActivity = vi.fn(),
}: RenderOptions = {}) {
  const resolvedItems = items ?? makeSampleItems(role);

  mockUseAuth.mockReturnValue(makeAuthValue(role));
  mockUseInventoryItems.mockReturnValue({
    data: resolvedItems,
    isLoading: false,
    isError: Boolean(inventoryError),
    error: inventoryError,
    refetch: refetchInventory,
  });
  mockUseCategories.mockReturnValue({
    data: categories,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseEquipmentTypes.mockReturnValue({
    data: equipmentTypes,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLoans.mockImplementation((enabled: boolean) => ({
    loans: enabled ? loans : [],
    activeLoans: enabled ? loans.filter((l) => l.returned_at == null) : [],
    returnedLoans: enabled ? loans.filter((l) => l.returned_at != null) : [],
    isLoading: false,
    isError: enabled ? Boolean(loansError) : false,
    error: enabled ? loansError : null,
    refetch: refetchLoans,
  }));
  mockUseActivityLog.mockImplementation((enabled: boolean) => ({
    entries: enabled ? history : [],
    isLoading: false,
    isError: enabled ? Boolean(activityError) : false,
    error: enabled ? activityError : null,
    refetch: refetchActivity,
  }));

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inventory" element={<RouteEcho />} />
          <Route path="/loans" element={<RouteEcho />} />
          <Route path="/activity" element={<RouteEcho />} />
          <Route path="/checklist" element={<RouteEcho />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DashboardPage', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = MockResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders KPI summary (with qty = 0 and anonymous On Loan units), Low Stock callout, Needs Attention, and Equipment Type / Rig Health breakdown for Guests without querying or rendering borrower names or Recent Activity', async () => {
    const user = userEvent.setup();
    renderDashboard({ role: 'guest' });

    expect(mockUseInventoryItems).toHaveBeenCalledWith('guest');
    expect(mockUseLoans).toHaveBeenCalledWith(false);
    expect(mockUseActivityLog).toHaveBeenCalledWith(false);

    expect(screen.getByRole('heading', { name: 'Operations Dashboard' })).toBeInTheDocument();

    // KPI counts: 4 logged items (including qty = 0), 7 total units, 2 working, 2 flagged, 3 on loan units
    expect(within(screen.getByTestId('kpi-logged-items')).getByText('4')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-total-units')).getByText('7')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-working')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-flagged')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-on-loan')).getByText('3')).toBeInTheDocument();

    // Low Stock callout shows 2 low-stock items (Radial J48 qty 4 <= min 4, XLR Spare Loom qty 0 <= min 2)
    const lowStockCallout = screen.getByTestId('dashboard-low-stock');
    expect(lowStockCallout).toHaveAttribute('href', '/inventory?stock=low');
    expect(within(lowStockCallout).getByText('2')).toBeInTheDocument();
    expect(within(lowStockCallout).getByText(/^low stock$/i)).toBeInTheDocument();
    expect(within(lowStockCallout).getByText(/restock alert/i)).toBeInTheDocument();

    // Needs Attention shows repair and missing items only
    const attentionPanel = screen.getByTestId('dashboard-needs-attention');
    expect(within(attentionPanel).getByText('Radial J48 DI Box')).toBeInTheDocument();
    expect(within(attentionPanel).getByText('XLR Spare Loom')).toBeInTheDocument();
    expect(within(attentionPanel).queryByText('Pearl Brass Snare')).not.toBeInTheDocument();

    // Inventory Health Breakdown defaults to Equipment Type ('type')
    const healthPanel = screen.getByTestId('dashboard-category-health');
    expect(within(healthPanel).getByRole('button', { name: /equipment type/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(healthPanel).getByText('Instruments')).toBeInTheDocument();
    expect(within(healthPanel).getByText('DI Boxes & Effects')).toBeInTheDocument();
    expect(within(healthPanel).getByText('Cables & Cords')).toBeInTheDocument();
    expect(within(healthPanel).getByText(/2 items · 3 units/i)).toBeInTheDocument();

    // Toggling to Rig switches breakdown to Rig Categories
    await user.click(within(healthPanel).getByRole('button', { name: /^rig$/i }));
    expect(within(healthPanel).getByText('Drums')).toBeInTheDocument();
    expect(within(healthPanel).getByText('Spares & Shared')).toBeInTheDocument();
    expect(within(healthPanel).getByText('Keyboard')).toBeInTheDocument();
    expect(within(healthPanel).getByText(/2 items · 4 units/i)).toBeInTheDocument();

    // Strict Guest privacy isolation: zero borrower names, zero loans panel, zero Recent Activity or emails
    expect(screen.queryByRole('heading', { name: /active & overdue loans/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /recent activity/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Joel Santos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mia Reyes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/dan@wingmacc\.org/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/eli@wingmacc\.org/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dan Caleb/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Eli Cruz/i)).not.toBeInTheDocument();
  });

  it('routes Guest clicks on KPIs, Low Stock callout, Needs Attention items, Equipment Type cards, and Rig Category cards to filtered /inventory destinations', async () => {
    const user = userEvent.setup();

    let rendered = renderDashboard({ role: 'guest' });
    await user.click(screen.getByTestId('kpi-logged-items'));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    await user.click(screen.getByTestId('kpi-total-units'));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    await user.click(screen.getByTestId('kpi-on-loan'));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory?loan=on-loan');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    await user.click(screen.getByTestId('kpi-flagged'));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory?condition=flagged');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    await user.click(screen.getByTestId('kpi-working'));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory?condition=working');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    await user.click(screen.getByTestId('dashboard-low-stock'));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory?stock=low');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    const attention = screen.getByTestId('dashboard-needs-attention');
    await user.click(within(attention).getByRole('link', { name: /radial j48 di box/i }));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory?item=item-di');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    const typePanel = screen.getByTestId('dashboard-category-health');
    await user.click(within(typePanel).getByRole('link', { name: /instruments/i }));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory?type=et-inst');
    rendered.unmount();

    rendered = renderDashboard({ role: 'guest' });
    const rigPanel = screen.getByTestId('dashboard-category-health');
    await user.click(within(rigPanel).getByRole('button', { name: /^rig$/i }));
    await user.click(within(rigPanel).getByRole('link', { name: /spares & shared/i }));
    expect(screen.getByTestId('route-echo')).toHaveTextContent('/inventory?category=cat-spares');
    rendered.unmount();
  });

  it('renders Active & Overdue Loans and Recent Activity for Members and Admins and links On Loan KPI to /loans', async () => {
    const user = userEvent.setup();

    for (const role of ['member', 'admin'] as const) {
      const { unmount } = renderDashboard({ role });

      expect(mockUseLoans).toHaveBeenCalledWith(true);
      expect(mockUseActivityLog).toHaveBeenCalledWith(true);

      const loansPanel = screen.getByTestId('dashboard-active-loans');
      expect(within(loansPanel).getByRole('heading', { name: /active & overdue loans/i })).toBeInTheDocument();
      expect(within(loansPanel).getByText('Joel Santos')).toBeInTheDocument();
      expect(within(loansPanel).getByText('Mia Reyes')).toBeInTheDocument();
      expect(within(loansPanel).getByText('Overdue')).toBeInTheDocument();
      expect(within(loansPanel).queryByText('Returned Borrower Hidden')).not.toBeInTheDocument();

      const activityPanel = screen.getByTestId('dashboard-recent-activity');
      expect(within(activityPanel).getByRole('heading', { name: /recent activity/i })).toBeInTheDocument();
      expect(within(activityPanel).getByText('Pearl Brass Snare')).toBeInTheDocument();
      expect(within(activityPanel).getByText(/Verified Sunday check-off/i)).toBeInTheDocument();
      expect(within(activityPanel).getByText(/Condition -> REPAIR/i)).toBeInTheDocument();

      await user.click(screen.getByTestId('kpi-on-loan'));
      expect(screen.getByTestId('route-echo')).toHaveTextContent('/loans');

      unmount();
    }
  });

  it('shows healthy empty states when zero items are flagged, low-stock, loaned, or logged in activity', () => {
    const workingOnly = makeSampleItems('member').map((item) => ({
      ...item,
      condition: 'working' as const,
      qty_on_loan: 0,
      available_qty: item.qty,
      min_qty: null,
    }));

    renderDashboard({
      role: 'member',
      items: workingOnly,
      loans: [],
      history: [],
    });

    const lowStockCallout = screen.getByTestId('dashboard-low-stock');
    expect(within(lowStockCallout).getByText('0 low-stock items')).toBeInTheDocument();
    expect(lowStockCallout).toHaveAttribute('href', '/inventory?stock=low');

    expect(
      within(screen.getByTestId('dashboard-needs-attention')).getByText(
        /all equipment is in working condition/i
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('dashboard-active-loans')).getByText(
        /no equipment is currently on loan/i
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('dashboard-recent-activity')).getByText(
        /no recent activity recorded yet/i
      )
    ).toBeInTheDocument();
  });

  it('renders an alert with Retry when inventory fails to load and resiliently handles secondary loan/activity errors', async () => {
    const user = userEvent.setup();
    const refetchInventory = vi.fn();

    const { unmount } = renderDashboard({
      role: 'guest',
      inventoryError: new Error('Network offline'),
      refetchInventory,
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/network offline/i);
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetchInventory).toHaveBeenCalledTimes(1);
    unmount();

    const refetchLoans = vi.fn();
    renderDashboard({
      role: 'member',
      loansError: new Error('Loans unavailable'),
      refetchLoans,
    });

    expect(within(screen.getByTestId('kpi-logged-items')).getByText('4')).toBeInTheDocument();
    const loansPanel = screen.getByTestId('dashboard-active-loans');
    expect(within(loansPanel).getByRole('alert')).toHaveTextContent(/loans unavailable/i);
    await user.click(within(loansPanel).getByRole('button', { name: /retry/i }));
    expect(refetchLoans).toHaveBeenCalledTimes(1);
  });

  it('renders loading indicator while core inventory data is loading', () => {
    mockUseAuth.mockReturnValue(makeAuthValue('guest'));
    mockUseInventoryItems.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseCategories.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseEquipmentTypes.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseLoans.mockReturnValue({
      loans: [],
      activeLoans: [],
      returnedLoans: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseActivityLog.mockReturnValue({
      entries: [],
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
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole('status')).toHaveTextContent(/loading operations dashboard/i);
  });

  it('renders legacy outlier history actions and unexpected item condition values safely without crashing', () => {
    const outlierItems: EnrichedInventoryItem[] = [
      ...makeSampleItems('member'),
      {
        id: 'item-outlier-cond',
        category: 'Drums',
        category_id: 'cat-drums',
        subcategory_id: null,
        item: 'Legacy Pedal',
        brand: 'DW',
        qty: 1,
        condition: 'broken' as EnrichedInventoryItem['condition'],
        owner: 'Church Property',
        location: 'Stage',
        location_id: 'loc-stage',
        serial: null,
        description: null,
        image_filename: null,
        remarks: 'Legacy outlier condition',
        dateChecked: 'November 18, 2026',
        checked_at: '2026-11-18T09:00:00.000Z',
        checkedBy: 'Dan Caleb',
        qty_on_loan: 0,
        available_qty: 1,
        equipment_type_id: null,
        equipment_type: null,
        min_qty: null,
        activeLoans: [],
      },
    ];

    const outlierHistory: HistoryEntry[] = [
      {
        id: 'h-outlier',
        action: 'legacy_edit' as HistoryEntry['action'],
        item_id: 'item-outlier-cond',
        item_data: { id: 'item-outlier-cond', item: 'Legacy Pedal' },
        prev_data: null,
        user_email: 'legacy@wingmacc.org',
        undone: false,
        timestamp: '2026-11-18T12:00:00.000Z',
      },
    ];

    renderDashboard({
      role: 'member',
      items: outlierItems,
      history: outlierHistory,
      loans: [],
    });

    const attentionPanel = screen.getByTestId('dashboard-needs-attention');
    expect(within(attentionPanel).getByText('Legacy Pedal')).toBeInTheDocument();
    expect(within(attentionPanel).getByText('Broken')).toBeInTheDocument();

    const activityPanel = screen.getByTestId('dashboard-recent-activity');
    expect(within(activityPanel).getByText('Legacy_edit')).toBeInTheDocument();
    expect(within(activityPanel).getByText('Recorded legacy_edit action')).toBeInTheDocument();
  });

  it('exposes accessible role="progressbar" attributes on category and equipment-type health bars', async () => {
    const user = userEvent.setup();
    renderDashboard({ role: 'guest' });

    const healthPanel = screen.getByTestId('dashboard-category-health');
    const typeBars = within(healthPanel).getAllByRole('progressbar');
    expect(typeBars).toHaveLength(3);

    for (const bar of typeBars) {
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(bar).toHaveAttribute('aria-valuenow');
    }

    expect(
      within(healthPanel).getByRole('progressbar', { name: /Instruments health 100%/i })
    ).toHaveAttribute('aria-valuenow', '100');
    expect(
      within(healthPanel).getByRole('progressbar', { name: /DI Boxes & Effects health 0%/i })
    ).toHaveAttribute('aria-valuenow', '0');

    // Toggle to Rig Categories and verify progressbars there too
    await user.click(within(healthPanel).getByRole('button', { name: /^rig$/i }));
    const rigBars = within(healthPanel).getAllByRole('progressbar');
    expect(rigBars).toHaveLength(3);
    expect(
      within(healthPanel).getByRole('progressbar', { name: /Drums health 100%/i })
    ).toHaveAttribute('aria-valuenow', '100');
    expect(
      within(healthPanel).getByRole('progressbar', { name: /Spares & Shared health 0%/i })
    ).toHaveAttribute('aria-valuenow', '0');
  });
});
