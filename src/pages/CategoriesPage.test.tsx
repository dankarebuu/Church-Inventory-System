import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import { computeEquipmentTypeItemCounts } from '@/features/categories/categoryUi';
import { buildCategoryTree } from '@/features/categories/useCategories';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, EquipmentType, LocationRecord, UserRole } from '@/types/database';
import { CategoriesPage } from './CategoriesPage';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseCategories = vi.fn<() => {
  data: Category[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}>();
const mockUseLocations = vi.fn<() => {
  data: LocationRecord[];
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
const mockUseInventoryItems = vi.fn<(role: UserRole) => {
  data: EnrichedInventoryItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}>();

const mockCreateCategory = vi.fn();
const mockUpdateCategory = vi.fn();
const mockDeleteCategory = vi.fn();
const mockCreateLocation = vi.fn();
const mockUpdateLocation = vi.fn();
const mockDeleteLocation = vi.fn();
const mockCreateEquipmentType = vi.fn();
const mockUpdateEquipmentType = vi.fn();
const mockDeleteEquipmentType = vi.fn();

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/features/categories/useCategories', async () => {
  const actual = await vi.importActual<typeof import('@/features/categories/useCategories')>(
    '@/features/categories/useCategories'
  );
  return {
    ...actual,
    useCategories: () => mockUseCategories(),
    useCategoryMutations: () => ({
      createCategory: mockCreateCategory,
      updateCategory: mockUpdateCategory,
      deleteCategory: mockDeleteCategory,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      isSaving: false,
    }),
  };
});

vi.mock('@/features/locations/useLocations', async () => {
  const actual = await vi.importActual<typeof import('@/features/locations/useLocations')>(
    '@/features/locations/useLocations'
  );
  return {
    ...actual,
    useLocations: () => mockUseLocations(),
    useLocationMutations: () => ({
      createLocation: mockCreateLocation,
      updateLocation: mockUpdateLocation,
      deleteLocation: mockDeleteLocation,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      isSaving: false,
    }),
  };
});

vi.mock('@/features/equipmentTypes/useEquipmentTypes', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/equipmentTypes/useEquipmentTypes')
  >('@/features/equipmentTypes/useEquipmentTypes');
  return {
    ...actual,
    useEquipmentTypes: () => mockUseEquipmentTypes(),
    useEquipmentTypeMutations: () => ({
      createEquipmentType: mockCreateEquipmentType,
      updateEquipmentType: mockUpdateEquipmentType,
      deleteEquipmentType: mockDeleteEquipmentType,
      isCreating: false,
      isUpdating: false,
      isDeleting: false,
      isSaving: false,
    }),
  };
});

vi.mock('@/features/inventory/useInventory', async () => {
  const actual = await vi.importActual<typeof import('@/features/inventory/useInventory')>(
    '@/features/inventory/useInventory'
  );
  return {
    ...actual,
    useInventoryItems: (role: UserRole) => mockUseInventoryItems(role),
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
    id: 'cat-spares',
    name: 'Spares & Shared',
    parent_id: null,
    color: '#4e7fb0',
    icon: 'cable',
    sort_order: 70,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'sub-cymbals',
    name: 'Cymbals',
    parent_id: 'cat-drums',
    color: '#d97740',
    icon: 'music',
    sort_order: 20,
    created_at: '2026-11-18T00:00:00.000Z',
  },
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
    icon: 'drum',
    sort_order: 10,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

const sampleLocations: LocationRecord[] = [
  {
    id: 'loc-booth',
    name: 'Sound Booth',
    description: 'FOH mixer rack & DI cabinet',
    sort_order: 20,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'loc-stage',
    name: 'Stage',
    description: 'Main sanctuary worship platform',
    sort_order: 10,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

const sampleEquipmentTypes: EquipmentType[] = [
  {
    id: 'et-cables',
    name: 'Cables & Cords',
    color: '#4e7fb0',
    icon: 'cable',
    sort_order: 20,
    created_at: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'et-inst',
    name: 'Instruments',
    color: '#2563EB',
    icon: 'guitar',
    sort_order: 10,
    created_at: '2026-11-20T00:00:00.000Z',
  },
];

const sampleItems: EnrichedInventoryItem[] = [
  {
    id: 'item-1',
    category: 'Drums',
    category_id: 'cat-drums',
    subcategory_id: 'sub-snare',
    item: 'Pearl Brass Snare',
    brand: 'Pearl',
    qty: 1,
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
    qty_on_loan: 0,
    available_qty: 1,
    equipment_type_id: 'et-inst',
    equipment_type: 'Instruments',
    min_qty: null,
  },
  {
    id: 'item-2',
    category: 'Drums',
    category_id: 'cat-drums',
    subcategory_id: 'sub-cymbals',
    item: 'Zildjian K Ride',
    brand: 'Zildjian',
    qty: 1,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-stage',
    serial: null,
    description: null,
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    qty_on_loan: 0,
    available_qty: 1,
    equipment_type_id: null,
    equipment_type: '  instruments  ',
    min_qty: null,
  },
  {
    id: 'item-3',
    category: 'Drums',
    category_id: 'cat-drums',
    subcategory_id: null,
    item: 'DW Drum Throne',
    brand: 'DW',
    qty: 1,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-stage',
    serial: null,
    description: null,
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    qty_on_loan: 0,
    available_qty: 1,
    equipment_type_id: null,
    equipment_type: null,
    min_qty: null,
  },
  {
    id: 'item-4',
    category: 'Spares & Shared',
    category_id: 'cat-spares',
    subcategory_id: null,
    item: 'Mogami XLR Cable',
    brand: 'Mogami',
    qty: 4,
    condition: 'repair',
    owner: 'Church Property',
    location: 'Sound Booth',
    location_id: 'loc-booth',
    serial: null,
    description: null,
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    qty_on_loan: 0,
    available_qty: 4,
    equipment_type_id: 'et-cables',
    equipment_type: 'Cables & Cords',
    min_qty: null,
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

function renderCategoriesPage(role: UserRole, initialEntry = '/categories') {
  mockUseAuth.mockReturnValue(makeAuthValue(role));
  mockUseCategories.mockReturnValue({
    data: sampleCategories,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLocations.mockReturnValue({
    data: sampleLocations,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseEquipmentTypes.mockReturnValue({
    data: sampleEquipmentTypes,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseInventoryItems.mockReturnValue({
    data: sampleItems,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/inventory" element={<div data-testid="inventory-route">Inventory</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('buildCategoryTree', () => {
  it('groups flat category rows into sorted top-level categories with sorted nested subcategories', () => {
    const tree = buildCategoryTree(sampleCategories);

    expect(tree.map((node) => node.id)).toEqual(['cat-drums', 'cat-spares']);
    expect(tree[0].subcategories.map((sub) => sub.id)).toEqual(['sub-snare', 'sub-cymbals']);
    expect(tree[1].subcategories).toEqual([]);
  });
});

describe('computeEquipmentTypeItemCounts', () => {
  it('matches equipment_type_id first and falls back to case-insensitive equipment_type name', () => {
    const counts = computeEquipmentTypeItemCounts(
      [
        ...sampleItems,
        {
          ...sampleItems[0],
          id: 'item-stale-id',
          equipment_type_id: 'et-deleted',
          equipment_type: 'Instruments',
        },
        {
          ...sampleItems[0],
          id: 'item-id-overrides-name',
          equipment_type_id: 'et-cables',
          equipment_type: 'Instruments',
        },
      ],
      sampleEquipmentTypes
    );

    expect(counts.get('et-inst')).toBe(2);
    expect(counts.get('et-cables')).toBe(2);
  });
});

describe('CategoriesPage', () => {
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
    mockCreateCategory.mockResolvedValue({
      id: 'cat-new',
      name: 'Vocals',
      parent_id: null,
      color: '#2563EB',
      icon: 'mic',
      sort_order: 80,
      created_at: '2026-11-18T00:00:00.000Z',
    });
    mockUpdateCategory.mockResolvedValue({});
    mockDeleteCategory.mockResolvedValue(undefined);
    mockCreateLocation.mockResolvedValue({
      id: 'loc-new',
      name: 'Storage Closet',
      description: 'Backstage rack room',
      sort_order: 30,
      created_at: '2026-11-18T00:00:00.000Z',
    });
    mockUpdateLocation.mockResolvedValue({});
    mockDeleteLocation.mockResolvedValue(undefined);
    mockCreateEquipmentType.mockResolvedValue({
      id: 'et-new',
      name: 'Microphones',
      color: '#d3554a',
      icon: 'mic',
      sort_order: 30,
      created_at: '2026-11-20T00:00:00.000Z',
    });
    mockUpdateEquipmentType.mockResolvedValue({});
    mockDeleteEquipmentType.mockResolvedValue(undefined);
  });

  it('renders 2-level categories, item counts, subcategory chips, and click-through links for Guests without CRUD controls', async () => {
    const user = userEvent.setup();
    renderCategoriesPage('guest');

    expect(screen.getByRole('heading', { name: /categories & locations/i })).toBeInTheDocument();

    // Top-level category cards and item counts
    const drumsCard = screen.getByRole('article', { name: /drums/i });
    expect(within(drumsCard).getByText('3 items')).toBeInTheDocument();
    expect(within(drumsCard).getByText('Snares')).toBeInTheDocument();
    expect(within(drumsCard).getByText('Cymbals')).toBeInTheDocument();

    const drumsLink = within(drumsCard).getByRole('link', { name: /view.*drums|browse.*drums|drums/i });
    expect(drumsLink).toHaveAttribute('href', '/inventory?category=cat-drums');

    const snaresLink = within(drumsCard).getByRole('link', { name: /snares/i });
    expect(snaresLink).toHaveAttribute(
      'href',
      '/inventory?category=cat-drums&subcategory=sub-snare'
    );

    const sparesCard = screen.getByRole('article', { name: /spares & shared/i });
    expect(within(sparesCard).getByText('1 item')).toBeInTheDocument();

    // Guest must see zero CRUD buttons
    expect(screen.queryByRole('button', { name: /add category/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add subcategory/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    // Switch to Storage Locations tab
    await user.click(screen.getByRole('tab', { name: /storage locations/i }));

    const stageCard = await screen.findByRole('article', { name: /stage/i });
    expect(within(stageCard).getByText('Main sanctuary worship platform')).toBeInTheDocument();
    expect(within(stageCard).getByText('3 items')).toBeInTheDocument();
    const stageLink = within(stageCard).getByRole('link', { name: /view.*stage|browse.*stage|stage/i });
    expect(stageLink).toHaveAttribute('href', '/inventory?location=loc-stage');

    expect(screen.queryByRole('button', { name: /add location/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('hides all category and location Add/Edit/Delete controls for Band Members', async () => {
    const user = userEvent.setup();
    renderCategoriesPage('member');

    expect(screen.getByRole('article', { name: /drums/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add category/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add subcategory/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /storage locations/i }));
    expect(await screen.findByRole('article', { name: /sound booth/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add location/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('allows Admins to create a category with color swatch/hex + Lucide icon and delete with linked item & subcategory AlertDialog confirmation', async () => {
    const user = userEvent.setup();
    renderCategoriesPage('admin');

    // Create a top-level category
    await user.click(screen.getByRole('button', { name: /add category/i }));
    const dialog = await screen.findByRole('dialog');

    const nameInput = within(dialog).getByLabelText(/category name/i);
    await user.type(nameInput, '  Vocals  ');

    // Pick curated icon "mic" and custom hex color
    await user.click(within(dialog).getByRole('button', { name: /mic/i }));
    const hexInput = within(dialog).getByLabelText(/hex color/i);
    await user.clear(hexInput);
    await user.type(hexInput, '#2563EB');

    await user.click(within(dialog).getByRole('button', { name: /create category|save category/i }));

    await waitFor(() => {
      expect(mockCreateCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Vocals',
          parent_id: null,
          color: '#2563EB',
          icon: 'mic',
        })
      );
    });

    // Delete Drums category -> AlertDialog shows linked items (3) and subcategories (2)
    const drumsCard = screen.getByRole('article', { name: /drums/i });
    await user.click(within(drumsCard).getByRole('button', { name: /delete drums/i }));

    const alertDialog = await screen.findByRole('alertdialog');
    expect(within(alertDialog).getByText(/3 inventory items/i)).toBeInTheDocument();
    expect(within(alertDialog).getByText(/2 subcategories/i)).toBeInTheDocument();

    await user.click(within(alertDialog).getByRole('button', { name: /delete category/i }));
    await waitFor(() => {
      expect(mockDeleteCategory).toHaveBeenCalledWith('cat-drums');
    });
  });

  it('allows Admins to create a subcategory and surfaces duplicate-name errors inside the dialog', async () => {
    const user = userEvent.setup();
    mockCreateCategory.mockRejectedValueOnce(
      new Error('A subcategory named "Snares" already exists under this category.')
    );

    renderCategoriesPage('admin');

    const drumsCard = screen.getByRole('article', { name: /drums/i });
    await user.click(within(drumsCard).getByRole('button', { name: /add subcategory/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/category name/i), 'Snares');
    await user.click(within(dialog).getByRole('button', { name: /create subcategory|save/i }));

    expect(
      await within(dialog).findByRole('alert')
    ).toHaveTextContent(/already exists/i);
    expect(mockCreateCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Snares',
        parent_id: 'cat-drums',
      })
    );
  });

  it('allows Admins to create, edit, and delete storage locations with linked-item AlertDialog confirmation', async () => {
    const user = userEvent.setup();
    renderCategoriesPage('admin');

    await user.click(screen.getByRole('tab', { name: /storage locations/i }));

    // Create location
    await user.click(await screen.findByRole('button', { name: /add location/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/location name/i), 'Storage Closet');
    await user.type(within(dialog).getByLabelText(/description/i), 'Backstage rack room');
    await user.click(within(dialog).getByRole('button', { name: /create location|save/i }));

    await waitFor(() => {
      expect(mockCreateLocation).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Storage Closet',
          description: 'Backstage rack room',
        })
      );
    });

    // Edit Sound Booth location
    const boothCard = screen.getByRole('article', { name: /sound booth/i });
    await user.click(within(boothCard).getByRole('button', { name: /edit sound booth/i }));
    const editDialog = await screen.findByRole('dialog');
    const boothNameInput = within(editDialog).getByLabelText(/location name/i);
    await user.clear(boothNameInput);
    await user.type(boothNameInput, 'FOH Booth');
    await user.click(within(editDialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateLocation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'loc-booth',
          name: 'FOH Booth',
          description: 'FOH mixer rack & DI cabinet',
        })
      );
    });

    // Delete Stage location -> AlertDialog shows 3 linked inventory items
    const stageCard = screen.getByRole('article', { name: /stage/i });
    await user.click(within(stageCard).getByRole('button', { name: /delete stage/i }));

    const alertDialog = await screen.findByRole('alertdialog');
    expect(within(alertDialog).getByText(/3 inventory items/i)).toBeInTheDocument();

    await user.click(within(alertDialog).getByRole('button', { name: /delete location/i }));
    await waitFor(() => {
      expect(mockDeleteLocation).toHaveBeenCalledWith('loc-stage');
    });
  });

  it('renders all 12 curated Lucide icons, WINGMACC color swatches, and supports editing categories and deleting subcategories', async () => {
    const user = userEvent.setup();
    renderCategoriesPage('admin');

    // Open Add Category and verify all 12 curated Lucide icon choices + WINGMACC swatch picker
    await user.click(screen.getByRole('button', { name: /add category/i }));
    const addDialog = await screen.findByRole('dialog');
    const iconGroup = within(addDialog).getByRole('group', { name: /category icons/i });
    const expectedIcons = [
      'Tag',
      'Drum',
      'Guitar',
      'Piano',
      'Headphones',
      'Mic',
      'Cable',
      'Speaker',
      'Box',
      'Wrench',
      'Music',
      'Sliders',
    ];
    for (const iconLabel of expectedIcons) {
      expect(within(iconGroup).getByRole('button', { name: iconLabel })).toBeInTheDocument();
    }

    // Select a WINGMACC color swatch and confirm hex input updates
    await user.click(
      within(addDialog).getByRole('button', { name: /select color guitar crimson/i })
    );
    expect((within(addDialog).getByLabelText(/hex color/i) as HTMLInputElement).value).toBe(
      '#d3554a'
    );
    await user.click(within(addDialog).getByRole('button', { name: /cancel/i }));

    // Edit Drums top-level category (parent selector disabled because it has subcategories)
    const drumsCard = screen.getByRole('article', { name: /drums/i });
    await user.click(within(drumsCard).getByRole('button', { name: /edit drums/i }));
    const editDialog = await screen.findByRole('dialog');
    expect(within(editDialog).getByRole('combobox', { name: /parent category/i })).toBeDisabled();
    const editNameInput = within(editDialog).getByLabelText(/category name/i);
    await user.clear(editNameInput);
    await user.type(editNameInput, 'Percussion');
    await user.click(within(editDialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cat-drums',
          name: 'Percussion',
          previousName: 'Drums',
        })
      );
    });

    // Delete Snares subcategory -> AlertDialog shows 1 linked inventory item
    await user.click(within(drumsCard).getByRole('button', { name: /delete snares/i }));
    const alertDialog = await screen.findByRole('alertdialog');
    expect(within(alertDialog).getByText(/delete subcategory\?/i)).toBeInTheDocument();
    expect(within(alertDialog).getByText(/1 inventory item/i)).toBeInTheDocument();
    await user.click(within(alertDialog).getByRole('button', { name: /delete subcategory/i }));

    await waitFor(() => {
      expect(mockDeleteCategory).toHaveBeenCalledWith('sub-snare');
    });
  });

  it('supports the Equipment Types tab (?tab=types) with item counts, /inventory?type=<id> links, role guards, and Admin CRUD', async () => {
    const user = userEvent.setup();

    // 1. Guest visiting ?tab=types sees sorted equipment types, counts, and browse links with zero CRUD buttons
    const { unmount } = renderCategoriesPage('guest', '/categories?tab=types');

    const instCard = await screen.findByRole('article', { name: /instruments/i });
    expect(within(instCard).getByText('2 items')).toBeInTheDocument();
    expect(
      within(instCard).getByRole('link', { name: /view.*instruments|browse.*instruments/i })
    ).toHaveAttribute('href', '/inventory?type=et-inst');

    const cablesCard = screen.getByRole('article', { name: /cables & cords/i });
    expect(within(cablesCard).getByText('1 item')).toBeInTheDocument();
    expect(
      within(cablesCard).getByRole('link', { name: /view.*cables & cords/i })
    ).toHaveAttribute('href', '/inventory?type=et-cables');

    expect(screen.queryByRole('button', { name: /add equipment type/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    unmount();

    // 2. Band Member switching to Equipment Types tab sees zero CRUD controls
    const { unmount: unmountMember } = renderCategoriesPage('member');
    await user.click(screen.getByRole('tab', { name: /equipment types/i }));
    expect(await screen.findByRole('article', { name: /instruments/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add equipment type/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    unmountMember();

    // 3. Admin can create, edit, see duplicate error, and delete equipment types with linked item confirmation
    renderCategoriesPage('admin');
    await user.click(screen.getByRole('tab', { name: /equipment types/i }));

    await user.click(await screen.findByRole('button', { name: /add equipment type/i }));
    const createDialog = await screen.findByRole('dialog');
    await user.type(within(createDialog).getByLabelText(/type name/i), '  Microphones  ');
    await user.type(within(createDialog).getByLabelText(/sort order/i), '30');
    await user.click(within(createDialog).getByRole('button', { name: /mic/i }));
    await user.click(
      within(createDialog).getByRole('button', { name: /select color guitar crimson/i })
    );
    await user.click(within(createDialog).getByRole('button', { name: /create equipment type/i }));

    await waitFor(() => {
      expect(mockCreateEquipmentType).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Microphones',
          color: '#d3554a',
          icon: 'mic',
          sort_order: 30,
        })
      );
    });

    // Duplicate error surfaces inline inside EquipmentTypeDialog
    mockCreateEquipmentType.mockRejectedValueOnce(
      new Error('An equipment type named "Instruments" already exists.')
    );
    await user.click(screen.getByRole('button', { name: /add equipment type/i }));
    const dupDialog = await screen.findByRole('dialog');
    await user.type(within(dupDialog).getByLabelText(/type name/i), 'Instruments');
    await user.click(within(dupDialog).getByRole('button', { name: /create equipment type/i }));
    expect(await within(dupDialog).findByRole('alert')).toHaveTextContent(/already exists/i);
    await user.click(within(dupDialog).getByRole('button', { name: /cancel/i }));

    // Edit Cables & Cords
    const adminCablesCard = screen.getByRole('article', { name: /cables & cords/i });
    await user.click(within(adminCablesCard).getByRole('button', { name: /edit cables & cords/i }));
    const editDialog = await screen.findByRole('dialog');
    const editNameInput = within(editDialog).getByLabelText(/type name/i);
    await user.clear(editNameInput);
    await user.type(editNameInput, 'Stage Cables');
    await user.click(within(editDialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockUpdateEquipmentType).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'et-cables',
          name: 'Stage Cables',
          previousName: 'Cables & Cords',
        })
      );
    });

    // Delete Instruments -> AlertDialog shows 2 linked inventory items
    const adminInstCard = screen.getByRole('article', { name: /instruments/i });
    await user.click(within(adminInstCard).getByRole('button', { name: /delete instruments/i }));
    const alertDialog = await screen.findByRole('alertdialog');
    expect(within(alertDialog).getByText(/2 inventory items/i)).toBeInTheDocument();

    await user.click(within(alertDialog).getByRole('button', { name: /delete equipment type/i }));
    await waitFor(() => {
      expect(mockDeleteEquipmentType).toHaveBeenCalledWith('et-inst');
    });
  });

  it('disables Admin add, edit, and delete actions across Categories, Locations, and Equipment Types when offline', async () => {
    const user = userEvent.setup();
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderCategoriesPage('admin');

      expect(
        screen.getByText(/Offline — adding, editing, or deleting categories, locations, and equipment types is disabled/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /add category/i })).toBeDisabled();

      const drumsCard = screen.getByRole('article', { name: /drums/i });
      expect(within(drumsCard).getByRole('button', { name: /add subcategory/i })).toBeDisabled();
      expect(within(drumsCard).getByRole('button', { name: /edit drums/i })).toBeDisabled();
      expect(within(drumsCard).getByRole('button', { name: /delete drums/i })).toBeDisabled();
      expect(within(drumsCard).getByRole('button', { name: /edit cymbals/i })).toBeDisabled();
      expect(within(drumsCard).getByRole('button', { name: /delete cymbals/i })).toBeDisabled();

      await user.click(screen.getByRole('tab', { name: /storage locations/i }));
      expect(screen.getByRole('button', { name: /add location/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /edit stage/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /delete stage/i })).toBeDisabled();

      await user.click(screen.getByRole('tab', { name: /equipment types/i }));
      expect(screen.getByRole('button', { name: /add equipment type/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /edit instruments/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /delete instruments/i })).toBeDisabled();
    } finally {
      onLineSpy.mockRestore();
    }
  });
});
