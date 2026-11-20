import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, LocationRecord } from '@/types/database';
import { ItemFormDialog } from './ItemFormDialog';
import type { EnrichedInventoryItem, SaveItemInput } from './useInventory';

const mockSaveItem = vi.fn<(input: SaveItemInput) => Promise<unknown>>();

vi.mock('./useInventory', async () => {
  const actual = await vi.importActual<typeof import('./useInventory')>('./useInventory');
  return {
    ...actual,
    useItemMutations: () => ({
      saveItem: mockSaveItem,
      softDeleteItem: vi.fn(),
      memberCheckItem: vi.fn(),
      uploadGearPhotos: vi.fn(),
      isSaving: false,
      isDeleting: false,
      isChecking: false,
      isUploading: false,
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
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

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
  {
    id: 'sub-cables',
    name: 'XLR Cables',
    parent_id: 'cat-spares',
    color: '#4e7fb0',
    icon: 'cable',
    sort_order: 71,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

const mockLocations: LocationRecord[] = [
  {
    id: 'loc-stage',
    name: 'Stage',
    description: 'Main sanctuary stage',
    sort_order: 10,
    created_at: '2026-11-18T00:00:00.000Z',
  },
  {
    id: 'loc-booth',
    name: 'Sound Booth',
    description: 'FOH rack & cabinet',
    sort_order: 20,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

function makeItem(overrides: Partial<EnrichedInventoryItem> = {}): EnrichedInventoryItem {
  return {
    id: 'item_1',
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
    description: '14-inch snare drum',
    image_filename: null,
    remarks: 'Fresh coated head',
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    checkedBy: 'Dan Caleb',
    qty_on_loan: 0,
    available_qty: 2,
    equipment_type_id: null,
    equipment_type: null,
    min_qty: null,
    activeLoans: [],
    ...overrides,
  };
}

function renderDialog(props: Partial<React.ComponentProps<typeof ItemFormDialog>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onOpenChange = props.onOpenChange ?? vi.fn();

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ItemFormDialog
        open={true}
        onOpenChange={onOpenChange}
        categories={mockCategories}
        locations={mockLocations}
        {...props}
      />
    </QueryClientProvider>
  );

  return { ...utils, onOpenChange };
}

describe('ItemFormDialog', () => {
  let createObjectUrlSpy: ReturnType<typeof vi.fn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
  let urlCounter = 0;

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
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    urlCounter = 0;
    createObjectUrlSpy = vi.fn(() => `blob:http://localhost/preview-${++urlCounter}`);
    revokeObjectUrlSpy = vi.fn();
    URL.createObjectURL = createObjectUrlSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectUrlSpy as unknown as typeof URL.revokeObjectURL;
    mockSaveItem.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates preview URLs for selected photos and calls URL.revokeObjectURL when removed or closed', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ItemFormDialog
          open={true}
          onOpenChange={onOpenChange}
          categories={mockCategories}
          locations={mockLocations}
        />
      </QueryClientProvider>
    );

    const fileInput = screen.getByLabelText(/upload photos/i) as HTMLInputElement;
    const f1 = new File(['img-1'], 'snare-front.png', { type: 'image/png' });
    const f2 = new File(['img-2'], 'snare-back.jpg', { type: 'image/jpeg' });

    await user.upload(fileInput, [f1, f2]);

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
    expect(createObjectUrlSpy).toHaveBeenNthCalledWith(1, f1);
    expect(createObjectUrlSpy).toHaveBeenNthCalledWith(2, f2);

    const removeButtons = await screen.findAllByRole('button', { name: /remove photo/i });
    expect(removeButtons).toHaveLength(2);

    // Removing the first thumbnail must revoke its exact blob URL immediately.
    await user.click(removeButtons[0]);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/preview-1');

    // Closing the dialog must revoke the remaining preview URL.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ItemFormDialog
          open={false}
          onOpenChange={onOpenChange}
          categories={mockCategories}
          locations={mockLocations}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/preview-2');
    });
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(2);
  });

  it('revokes any remaining preview URLs on unmount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderDialog();

    const fileInput = screen.getByLabelText(/upload photos/i);
    const f1 = new File(['img-1'], 'unmount-test.png', { type: 'image/png' });

    await user.upload(fileInput, [f1]);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);

    unmount();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:http://localhost/preview-1');
  });

  it('submits qty = 0 accurately without fallback to 1 and cascades category/location names', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderDialog({
      item: makeItem({ qty: 3 }),
      onOpenChange,
    });

    const qtyInput = screen.getByLabelText(/quantity/i);
    await user.clear(qtyInput);
    await user.type(qtyInput, '0');

    // Change Category to "Spares & Shared" and select Subcategory "XLR Cables" + Location "Sound Booth"
    await user.click(screen.getByRole('combobox', { name: /^category$/i }));
    await user.click(await screen.findByRole('option', { name: 'Spares & Shared' }));

    await user.click(screen.getByRole('combobox', { name: /subcategory/i }));
    await user.click(await screen.findByRole('option', { name: 'XLR Cables' }));

    await user.click(screen.getByRole('combobox', { name: /location/i }));
    await user.click(await screen.findByRole('option', { name: 'Sound Booth' }));

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockSaveItem).toHaveBeenCalledTimes(1);
    });

    const callArg = mockSaveItem.mock.calls[0][0];
    expect(callArg.values.qty).toBe(0);
    expect(callArg.values.category_id).toBe('cat-spares');
    expect(callArg.values.category).toBe('Spares & Shared');
    expect(callArg.values.subcategory_id).toBe('sub-cables');
    expect(callArg.values.location_id).toBe('loc-booth');
    expect(callArg.values.location).toBe('Sound Booth');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('never renders legacy borrower or returnDate inputs and rejects non-image uploads without creating blob URLs', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderDialog({ item: makeItem() });

    expect(screen.queryByLabelText(/borrower/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/return\s*date/i)).not.toBeInTheDocument();

    const fileInput = screen.getByLabelText(/upload photos/i);
    const badFile = new File(['hello'], 'manual.pdf', { type: 'application/pdf' });
    await user.upload(fileInput, [badFile]);

    expect(createObjectUrlSpy).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/manual\.pdf/i);
  });

  it('preserves unsaved edits and pending photos when categories/locations references change while open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ItemFormDialog
          open={true}
          onOpenChange={onOpenChange}
          item={makeItem({ item: 'Original Snare' })}
          categories={mockCategories}
          locations={mockLocations}
        />
      </QueryClientProvider>
    );

    const nameInput = screen.getByLabelText(/item name/i) as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'Edited Brass Snare');

    const fileInput = screen.getByLabelText(/upload photos/i);
    const f1 = new File(['img-1'], 'pending-snare.png', { type: 'image/png' });
    await user.upload(fileInput, [f1]);

    expect(nameInput.value).toBe('Edited Brass Snare');
    expect(screen.getAllByRole('button', { name: /remove photo/i })).toHaveLength(1);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    // Simulate background query refetch / Realtime invalidation supplying fresh array & object references
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ItemFormDialog
          open={true}
          onOpenChange={onOpenChange}
          item={makeItem({ item: 'Original Snare' })}
          categories={[...mockCategories]}
          locations={[...mockLocations]}
        />
      </QueryClientProvider>
    );

    expect((screen.getByLabelText(/item name/i) as HTMLInputElement).value).toBe(
      'Edited Brass Snare'
    );
    expect(screen.getAllByRole('button', { name: /remove photo/i })).toHaveLength(1);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();
  });
});
