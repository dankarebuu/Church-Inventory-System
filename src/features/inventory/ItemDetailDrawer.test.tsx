import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { Category, EquipmentType, LocationRecord, UserRole } from '@/types/database';
import { ItemDetailDrawer } from './ItemDetailDrawer';
import type { EnrichedInventoryItem } from './useInventory';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseItemComments = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/features/comments/useItemComments', async () => {
  const actual = await vi.importActual<typeof import('@/features/comments/useItemComments')>(
    '@/features/comments/useItemComments'
  );
  return {
    ...actual,
    useItemComments: (...args: unknown[]) => {
      mockUseItemComments(...args);
      return {
        data: [],
        isLoading: false,
        isFetching: false,
        isSuccess: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    },
    useCommentMutations: () => ({
      addComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      togglePinComment: vi.fn(),
      isAdding: false,
      isUpdating: false,
      isDeleting: false,
      isTogglingPin: false,
      pendingCommentId: null,
    }),
  };
});

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
];

const sampleLocations: LocationRecord[] = [
  {
    id: 'loc-stage',
    name: 'Stage',
    description: null,
    sort_order: 10,
    created_at: '2026-11-18T00:00:00.000Z',
  },
];

const sampleEquipmentTypes: EquipmentType[] = [
  {
    id: 'et-mics',
    name: 'Microphones',
    color: '#d3554a',
    icon: 'mic',
    sort_order: 10,
    created_at: '2026-11-20T00:00:00.000Z',
  },
];

function makeAuthContext(role: UserRole): AuthContextValue {
  const isGuest = role === 'guest';
  return {
    user: isGuest ? null : ({ id: 'user-1', email: `${role}@wingmacc.org` } as never),
    profile: isGuest
      ? null
      : {
          id: 'user-1',
          email: `${role}@wingmacc.org`,
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

function makeItem(overrides: Partial<EnrichedInventoryItem> = {}): EnrichedInventoryItem {
  return {
    id: 'item-1',
    category: 'Drums',
    category_id: 'cat-drums',
    subcategory_id: null,
    item: 'Shure SM58',
    brand: 'Shure',
    qty: 1,
    min_qty: 2,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-stage',
    serial: 'SM58-01',
    description: 'Vocal mic',
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    qty_on_loan: 0,
    available_qty: 1,
    equipment_type_id: 'et-mics',
    equipment_type: 'Microphones',
    ...overrides,
  };
}

function renderDrawer(
  role: UserRole,
  props: Partial<React.ComponentProps<typeof ItemDetailDrawer>> = {}
) {
  mockUseAuth.mockReturnValue(makeAuthContext(role));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ItemDetailDrawer
        item={makeItem()}
        open={true}
        onOpenChange={vi.fn()}
        role={role}
        categories={sampleCategories}
        locations={sampleLocations}
        equipmentTypes={sampleEquipmentTypes}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('ItemDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays Equipment Type and Min Stock Alert specs while enforcing strict Guest isolation for photos and comments', () => {
    renderDrawer('guest', {
      item: makeItem({ qty: 1, min_qty: 2 }),
    });

    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Microphones')).toBeInTheDocument();
    expect(within(drawer).getByText('Min Stock Alert')).toBeInTheDocument();
    expect(within(drawer).getByText('2')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Low Stock').length).toBeGreaterThan(0);

    // Guest must never see Take / Add Photo or Notes & Maintenance Log or fire comment queries
    expect(within(drawer).queryByRole('button', { name: /take \/ add photo/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/notes & maintenance log/i)).not.toBeInTheDocument();
    expect(mockUseItemComments).not.toHaveBeenCalled();
  });

  it('supports Take / Add Photo for Members and Admins with capture="environment", 4-photo cap, and immediate refresh', async () => {
    const user = userEvent.setup();
    const onAddPhoto = vi.fn().mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    mockUseAuth.mockReturnValue(makeAuthContext('member'));

    const initialItem = makeItem({
      image_filename: '["https://cdn.example.com/p1.jpg"]',
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ItemDetailDrawer
          item={initialItem}
          open={true}
          onOpenChange={vi.fn()}
          role="member"
          categories={sampleCategories}
          locations={sampleLocations}
          equipmentTypes={sampleEquipmentTypes}
          onAddPhoto={onAddPhoto}
        />
      </QueryClientProvider>
    );

    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/notes & maintenance log/i)).toBeInTheDocument();
    expect(mockUseItemComments).toHaveBeenCalledWith('item-1', true);

    const takePhotoBtn = within(drawer).getByRole('button', { name: /take \/ add photo/i });
    expect(takePhotoBtn).toBeEnabled();

    const fileInput = drawer.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(fileInput).toHaveAttribute('accept', 'image/*');
    expect(fileInput).toHaveAttribute('capture', 'environment');
    expect(fileInput).toHaveClass('hidden');

    const imgFile = new File(['photo-bytes'], 'mic-stage.jpg', { type: 'image/jpeg' });
    await user.upload(fileInput, imgFile);

    await waitFor(() => {
      expect(onAddPhoto).toHaveBeenCalledWith(initialItem, imgFile);
    });

    // Simulate items query refetch updating the item with a second photo
    rerender(
      <QueryClientProvider client={queryClient}>
        <ItemDetailDrawer
          item={makeItem({
            image_filename:
              '["https://cdn.example.com/p1.jpg","https://cdn.example.com/p2.jpg"]',
          })}
          open={true}
          onOpenChange={vi.fn()}
          role="member"
          categories={sampleCategories}
          locations={sampleLocations}
          equipmentTypes={sampleEquipmentTypes}
          onAddPhoto={onAddPhoto}
        />
      </QueryClientProvider>
    );

    expect(within(drawer).getByRole('button', { name: /view photo 2/i })).toBeInTheDocument();

    // At 4 photos, Take / Add Photo is hidden
    rerender(
      <QueryClientProvider client={queryClient}>
        <ItemDetailDrawer
          item={makeItem({
            image_filename:
              '["https://cdn.example.com/p1.jpg","https://cdn.example.com/p2.jpg","https://cdn.example.com/p3.jpg","https://cdn.example.com/p4.jpg"]',
          })}
          open={true}
          onOpenChange={vi.fn()}
          role="admin"
          categories={sampleCategories}
          locations={sampleLocations}
          equipmentTypes={sampleEquipmentTypes}
          onAddPhoto={onAddPhoto}
        />
      </QueryClientProvider>
    );

    expect(
      within(drawer).queryByRole('button', { name: /take \/ add photo/i })
    ).not.toBeInTheDocument();
  });

  it('disables Take / Add Photo while uploading or offline, hides Min Stock Alert when null, and rejects invalid files', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onAddPhoto = vi.fn();

    const { unmount } = renderDrawer('admin', {
      item: makeItem({ min_qty: null, equipment_type_id: null, equipment_type: null }),
      onAddPhoto,
      isUploadingPhoto: true,
    });

    const drawer = screen.getByRole('dialog');
    expect(within(drawer).queryByText('Min Stock Alert')).not.toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /uploading/i })).toBeDisabled();
    unmount();

    const { unmount: unmountOffline } = renderDrawer('member', {
      onAddPhoto,
      isOffline: true,
    });
    const offlineDrawer = screen.getByRole('dialog');
    expect(
      within(offlineDrawer).getByRole('button', { name: /take \/ add photo/i })
    ).toBeDisabled();
    expect(within(offlineDrawer).getByText(/you are offline/i)).toBeInTheDocument();
    unmountOffline();

    renderDrawer('member', { onAddPhoto });
    const activeDrawer = screen.getByRole('dialog');
    const fileInput = activeDrawer.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(['not-an-image'], 'notes.txt', { type: 'text/plain' })
    );

    expect(onAddPhoto).not.toHaveBeenCalled();
    expect(await within(activeDrawer).findByRole('alert')).toHaveTextContent(/notes\.txt/i);
  });

  it('disables Quick Sunday Check, Check Out, Return, Edit, and Trash controls when isOffline is true', () => {
    renderDrawer('admin', {
      item: makeItem({
        available_qty: 2,
        qty_on_loan: 1,
        activeLoans: [
          {
            id: 'loan-offline-1',
            item_id: 'item-1',
            borrower_name: 'Joel Santos',
            borrower_contact: '09171234567',
            qty_loaned: 1,
            checked_out_at: '2026-11-20T08:00:00.000Z',
            due_date: '2026-11-25',
            returned_at: null,
            checked_out_by: 'dan@wingmacc.org',
            returned_by: null,
            notes: null,
          },
        ],
      }),
      onAddPhoto: vi.fn(),
      onQuickCheck: vi.fn(),
      onCheckout: vi.fn(),
      onReturnLoan: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      isOffline: true,
    });

    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/Offline read-only mode/i)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /^ok$/i })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: /^fix$/i })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: /^lost$/i })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: /take \/ add photo/i })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: /^check out$/i })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: /^return$/i })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: /^edit$/i })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: /^trash$/i })).toBeDisabled();
  });

  it('keeps the Radix Sheet root mounted when item is null and closes cleanly when item transitions to null', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockUseAuth.mockReturnValue(makeAuthContext('guest'));

    const { container, rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ItemDetailDrawer
          item={null}
          open={false}
          onOpenChange={vi.fn()}
          role="guest"
          categories={sampleCategories}
          locations={sampleLocations}
          equipmentTypes={sampleEquipmentTypes}
        />
      </QueryClientProvider>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <ItemDetailDrawer
          item={makeItem()}
          open={true}
          onOpenChange={vi.fn()}
          role="guest"
          categories={sampleCategories}
          locations={sampleLocations}
          equipmentTypes={sampleEquipmentTypes}
        />
      </QueryClientProvider>
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <ItemDetailDrawer
          item={null}
          open={false}
          onOpenChange={vi.fn()}
          role="guest"
          categories={sampleCategories}
          locations={sampleLocations}
          equipmentTypes={sampleEquipmentTypes}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(container).toBeInTheDocument();
  });

  it('opens ZoomLightbox cleanly inside ItemDetailDrawer using entrance/exit sheet classes without trapping fixed overlay', async () => {
    const user = userEvent.setup();
    renderDrawer('guest', {
      item: makeItem({
        image_filename: '["https://cdn.example.com/p1.jpg"]',
      }),
    });

    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveAttribute('data-slot', 'sheet-content');
    expect(drawer).toHaveAttribute('data-state', 'open');
    expect(drawer.className).toContain('data-[state=open]:animate-sheet-in-right');
    expect(drawer.className).toContain('data-[state=closed]:animate-sheet-out-right');

    await user.click(within(drawer).getByRole('button', { name: /open full preview of shure sm58/i }));
    const lightbox = await screen.findByRole('dialog', { name: /shure sm58 lightbox preview/i });
    expect(lightbox).toHaveClass('fixed', 'inset-0');

    await user.click(within(lightbox).getByRole('button', { name: /zoom in/i }));
    expect(within(lightbox).getByText('250%')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /shure sm58 lightbox preview/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBe(drawer);
  });
});
