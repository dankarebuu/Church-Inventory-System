import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, EquipmentType, LocationRecord } from '@/types/database';
import { BulkAssignDialog } from './BulkAssignDialog';
import type { BulkUpdateItemsInput, BulkUpdateItemsResult } from './useInventory';

const mockBulkUpdateItems = vi.fn<(input: BulkUpdateItemsInput) => Promise<BulkUpdateItemsResult>>();
let mockIsBulkUpdating = false;

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./useInventory', async () => {
  const actual = await vi.importActual<typeof import('./useInventory')>('./useInventory');
  return {
    ...actual,
    useItemMutations: () => ({
      saveItem: vi.fn(),
      softDeleteItem: vi.fn(),
      memberCheckItem: vi.fn(),
      uploadGearPhotos: vi.fn(),
      addItemPhoto: vi.fn(),
      bulkUpdateItems: mockBulkUpdateItems,
      isSaving: false,
      isDeleting: false,
      isChecking: false,
      isUploading: false,
      isAddingPhoto: false,
      isBulkUpdating: mockIsBulkUpdating,
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

const mockCategories: Category[] = [
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

const mockEquipmentTypes: EquipmentType[] = [
  {
    id: 'et-mics',
    name: 'Microphones',
    color: '#d3554a',
    icon: 'mic',
    sort_order: 90,
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

const mockLocations: LocationRecord[] = [
  {
    id: 'loc-stage',
    name: 'Stage',
    description: 'Main Stage',
    sort_order: 10,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'loc-booth',
    name: 'Sound Booth',
    description: 'FOH Booth',
    sort_order: 20,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

function renderDialog(props: Partial<React.ComponentProps<typeof BulkAssignDialog>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <BulkAssignDialog
        open={true}
        onOpenChange={onOpenChange}
        selectedIds={['item-1', 'item-2']}
        categories={mockCategories}
        locations={mockLocations}
        equipmentTypes={mockEquipmentTypes}
        onSuccess={onSuccess}
        {...props}
      />
    </QueryClientProvider>
  );

  return { ...utils, onOpenChange, onSuccess };
}

describe('BulkAssignDialog', () => {
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
    mockIsBulkUpdating = false;
    mockBulkUpdateItems.mockResolvedValue({
      updatedCount: 2,
      skippedCount: 0,
      updatedIds: ['item-1', 'item-2'],
    });
  });

  it('requires at least one changed field before enabling Apply and shows selected count', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onSuccess } = renderDialog({
      selectedIds: ['item-1', 'item-2', 'item-3'],
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/3 items selected/i)).toBeInTheDocument();

    const applyBtn = within(dialog).getByRole('button', { name: /apply/i });
    expect(applyBtn).toBeDisabled();
    expect(within(dialog).getByRole('combobox', { name: /subcategory/i })).toBeDisabled();

    // Selecting Rig Category enables Apply and Subcategory when subcategories exist
    await user.click(within(dialog).getByRole('combobox', { name: /rig category/i }));
    await user.click(await screen.findByRole('option', { name: 'Drums' }));

    expect(applyBtn).toBeEnabled();
    expect(within(dialog).getByRole('combobox', { name: /subcategory/i })).toBeEnabled();

    await user.click(within(dialog).getByRole('combobox', { name: /subcategory/i }));
    await user.click(await screen.findByRole('option', { name: 'Snares' }));

    await user.click(within(dialog).getByRole('combobox', { name: /equipment type/i }));
    await user.click(await screen.findByRole('option', { name: 'Instruments' }));

    await user.click(within(dialog).getByRole('combobox', { name: /storage location/i }));
    await user.click(await screen.findByRole('option', { name: 'Sound Booth' }));

    await user.click(applyBtn);

    await waitFor(() => {
      expect(mockBulkUpdateItems).toHaveBeenCalledWith({
        itemIds: ['item-1', 'item-2', 'item-3'],
        category_id: 'cat-drums',
        category: 'Drums',
        subcategory_id: 'sub-snare',
        equipment_type_id: 'et-inst',
        equipment_type: 'Instruments',
        location_id: 'loc-booth',
        location: 'Sound Booth',
      });
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('allows clearing Equipment Type or Storage Location independently and supports None / General subcategory', async () => {
    const user = userEvent.setup();
    renderDialog({ selectedIds: ['item-1'] });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/1 item selected/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('combobox', { name: /rig category/i }));
    await user.click(await screen.findByRole('option', { name: 'Drums' }));

    await user.click(within(dialog).getByRole('combobox', { name: /subcategory/i }));
    await user.click(await screen.findByRole('option', { name: /none \/ general/i }));

    await user.click(within(dialog).getByRole('combobox', { name: /equipment type/i }));
    await user.click(await screen.findByRole('option', { name: /clear \/ unassigned/i }));

    await user.click(within(dialog).getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(mockBulkUpdateItems).toHaveBeenCalledWith({
        itemIds: ['item-1'],
        category_id: 'cat-drums',
        category: 'Drums',
        subcategory_id: null,
        equipment_type_id: null,
        equipment_type: null,
      });
    });
  });

  it('surfaces inline error without closing or clearing selection when bulkUpdateItems fails', async () => {
    const user = userEvent.setup();
    mockBulkUpdateItems.mockRejectedValueOnce(new Error('Permission denied by RLS'));
    const { onOpenChange, onSuccess } = renderDialog();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: /storage location/i }));
    await user.click(await screen.findByRole('option', { name: 'Stage' }));

    await user.click(within(dialog).getByRole('button', { name: /apply/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /permission denied by rls/i
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('disables submit and shows offline notice when isOffline is true', async () => {
    const user = userEvent.setup();
    renderDialog({ isOffline: true });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('status')).toHaveTextContent(/offline/i);

    await user.click(within(dialog).getByRole('combobox', { name: /equipment type/i }));
    await user.click(await screen.findByRole('option', { name: 'Microphones' }));

    expect(within(dialog).getByRole('button', { name: /apply/i })).toBeDisabled();
    expect(mockBulkUpdateItems).not.toHaveBeenCalled();
  });

  it('preserves selections on background reference churn and resets when reopened', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <BulkAssignDialog
          open={true}
          onOpenChange={onOpenChange}
          selectedIds={['item-1', 'item-2']}
          categories={mockCategories}
          locations={mockLocations}
          equipmentTypes={mockEquipmentTypes}
        />
      </QueryClientProvider>
    );

    await user.click(screen.getByRole('combobox', { name: /equipment type/i }));
    await user.click(await screen.findByRole('option', { name: 'Microphones' }));
    expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled();

    // Background refetch gives fresh arrays while open -> selection must persist
    rerender(
      <QueryClientProvider client={queryClient}>
        <BulkAssignDialog
          open={true}
          onOpenChange={onOpenChange}
          selectedIds={['item-1', 'item-2']}
          categories={[...mockCategories]}
          locations={[...mockLocations]}
          equipmentTypes={[...mockEquipmentTypes]}
        />
      </QueryClientProvider>
    );
    expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled();

    // Close and reopen -> fields reset to Leave unchanged
    rerender(
      <QueryClientProvider client={queryClient}>
        <BulkAssignDialog
          open={false}
          onOpenChange={onOpenChange}
          selectedIds={['item-1', 'item-2']}
          categories={mockCategories}
          locations={mockLocations}
          equipmentTypes={mockEquipmentTypes}
        />
      </QueryClientProvider>
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <BulkAssignDialog
          open={true}
          onOpenChange={onOpenChange}
          selectedIds={['item-1', 'item-2']}
          categories={mockCategories}
          locations={mockLocations}
          equipmentTypes={mockEquipmentTypes}
        />
      </QueryClientProvider>
    );

    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  });
});
