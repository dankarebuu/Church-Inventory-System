import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { queryKeys } from '@/lib/queryKeys';
import type { Category, LocationRecord, UserRole } from '@/types/database';
import { ImportWizardDialog } from './ImportWizardDialog';

const {
  mockAuthState,
  mockFrom,
  insertCalls,
  updateCalls,
  failInsertTables,
  resetMocks,
} = vi.hoisted(() => {
  const auth = {
    role: 'admin' as UserRole,
    user: { id: 'admin-1', email: 'dan@wingmacc.org' },
    profile: {
      id: 'admin-1',
      email: 'dan@wingmacc.org',
      first_name: 'Dan',
      last_name: 'Caleb',
      role: 'admin' as const,
      created_at: '2026-11-18T00:00:00.000Z',
    },
  };

  const inserts: Array<{ table: string; payload: unknown }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; id: unknown }> = [];
  const failInserts = new Map<string, string>();
  let createdCatCount = 0;
  let createdLocCount = 0;

  const from = vi.fn((table: string) => {
    const insertFn = vi.fn((payload: unknown) => {
      inserts.push({ table, payload });
      const rows = Array.isArray(payload) ? payload : [payload];
      const firstRow = (rows[0] ?? {}) as Record<string, unknown>;
      const forcedError = failInserts.get(table);

      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => {
            if (forcedError) {
              return { data: null, error: { message: forcedError } };
            }
            if (table === 'categories') {
              createdCatCount += 1;
              return {
                data: {
                  id: `cat-new-${createdCatCount}`,
                  name: String(firstRow.name ?? 'Category'),
                  parent_id: firstRow.parent_id ?? null,
                  color: String(firstRow.color ?? '#7a8290'),
                  icon: String(firstRow.icon ?? 'tag'),
                  sort_order: Number(firstRow.sort_order ?? 100),
                  created_at: '2026-11-18T00:00:00.000Z',
                },
                error: null,
              };
            }
            if (table === 'locations') {
              createdLocCount += 1;
              return {
                data: {
                  id: `loc-new-${createdLocCount}`,
                  name: String(firstRow.name ?? 'Location'),
                  description: null,
                  sort_order: Number(firstRow.sort_order ?? 100),
                  created_at: '2026-11-18T00:00:00.000Z',
                },
                error: null,
              };
            }
            return { data: firstRow, error: null };
          }),
        })),
        then: (
          onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) =>
          Promise.resolve(
            forcedError
              ? { data: null, error: { message: forcedError } }
              : { data: rows, error: null }
          ).then(onFulfilled, onRejected),
      };
    });

    const updateFn = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(async (_col: string, id: unknown) => {
        updates.push({ table, payload, id });
        return { data: null, error: null };
      }),
    }));

    return {
      select: vi.fn(async () => ({ data: [], error: null })),
      insert: insertFn,
      update: updateFn,
    };
  });

  return {
    mockAuthState: auth,
    mockFrom: from,
    insertCalls: inserts,
    updateCalls: updates,
    failInsertTables: failInserts,
    resetMocks: () => {
      auth.role = 'admin';
      inserts.length = 0;
      updates.length = 0;
      failInserts.clear();
      createdCatCount = 0;
      createdLocCount = 0;
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mockFrom,
  },
}));

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

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

const existingItems: EnrichedInventoryItem[] = [];

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe('ImportWizardDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('creates missing categories/locations, preserves qty=0, creates loans only when qty >= 1, and logs batch import', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizardDialog
          open={true}
          onOpenChange={onOpenChange}
          items={existingItems}
          categories={sampleCategories}
          locations={sampleLocations}
        />
      </QueryClientProvider>
    );

    const csvContent = [
      '"Equipment","Category","Qty","Location","Remarks","Borrower","Return Date"',
      '"Spare Snare, 14in","Drums","0","Stage","Needs head","Joel Santos","2026-11-25"',
      '"Direct Box","Audio Rig","2","Sound Booth","Active DI","Sam Lee","2026-11-28"',
    ].join('\r\n');

    const fileInput = screen.getByLabelText(/select csv or json file/i);
    const csvFile = new File([csvContent], 'gear.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    expect(await screen.findByText('Spare Snare, 14in')).toBeInTheDocument();
    expect(screen.getByText('Direct Box')).toBeInTheDocument();
    expect(screen.getByText(/loan skipped \(qty 0\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /start import \(2\)/i }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // Created new category "Audio Rig" and new location "Sound Booth"
    const catInsert = insertCalls.find((c) => c.table === 'categories');
    expect(catInsert).toBeDefined();
    expect((catInsert?.payload as Array<Record<string, unknown>>)[0].name).toBe('Audio Rig');

    const locInsert = insertCalls.find((c) => c.table === 'locations');
    expect(locInsert).toBeDefined();
    expect((locInsert?.payload as Array<Record<string, unknown>>)[0].name).toBe('Sound Booth');

    // Inserted both inventory items, preserving qty = 0 on the first
    const invInsert = insertCalls.find((c) => c.table === 'inventory');
    expect(invInsert).toBeDefined();
    const invRows = invInsert?.payload as Array<Record<string, unknown>>;
    expect(invRows).toHaveLength(2);
    expect(invRows[0].qty).toBe(0);
    expect(invRows[0].category_id).toBe('cat-drums');
    expect(invRows[0].location_id).toBe('loc-stage');
    expect(invRows[1].qty).toBe(2);
    expect(invRows[1].category_id).toBe('cat-new-1');
    expect(invRows[1].location_id).toBe('loc-new-1');

    // Only created a loan for Direct Box (qty=2), skipped Spare Snare (qty=0)
    const loanInsert = insertCalls.find((c) => c.table === 'loans');
    expect(loanInsert).toBeDefined();
    const loanRows = loanInsert?.payload as Array<Record<string, unknown>>;
    expect(loanRows).toHaveLength(1);
    expect(loanRows[0].borrower_name).toBe('Sam Lee');
    expect(loanRows[0].due_date).toBe('2026-11-28');
    expect(loanRows[0].qty_loaned).toBe(1);

    // Logged batch import entry in history_log
    const histInsert = insertCalls.find((c) => c.table === 'history_log');
    expect(histInsert).toBeDefined();
    const histRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(histRow.action).toBe('import');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.loans });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });

  it('shows inline validation error when CSV is missing an Item or Equipment header', async () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizardDialog
          open={true}
          onOpenChange={vi.fn()}
          items={existingItems}
          categories={sampleCategories}
          locations={sampleLocations}
        />
      </QueryClientProvider>
    );

    const fileInput = screen.getByLabelText(/select csv or json file/i);
    const badFile = new File(['"Category","Qty"\n"Drums","1"'], 'bad.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [badFile] } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/item.*equipment/i);
    expect(screen.getByRole('button', { name: /start import/i })).toBeDisabled();
  });

  it('supports update mode on matching items with clean prev_data snapshot and JSON import', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const queryClient = createTestQueryClient();

    const matchedExisting: EnrichedInventoryItem[] = [
      {
        id: 'item-existing-1',
        category: 'Drums',
        category_id: 'cat-drums',
        subcategory_id: null,
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
        remarks: 'Original remarks',
        dateChecked: 'November 18, 2026',
        checked_at: '2026-11-18T09:00:00.000Z',
        checkedBy: 'Dan Caleb',
        qty_on_loan: 0,
        available_qty: 2,
        activeLoans: [],
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizardDialog
          open={true}
          onOpenChange={onOpenChange}
          items={matchedExisting}
          categories={sampleCategories}
          locations={sampleLocations}
        />
      </QueryClientProvider>
    );

    const jsonContent = JSON.stringify({
      items: [
        {
          item: 'Pearl Brass Snare',
          category: 'Drums',
          qty: 0,
          condition: 'repair',
          serial: 'SN-100',
          remarks: 'Updated via backup',
        },
      ],
    });

    const fileInput = screen.getByLabelText(/select csv or json file/i);
    const jsonFile = new File([jsonContent], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(fileInput, { target: { files: [jsonFile] } });

    expect(await screen.findByText('Pearl Brass Snare')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /update existing matches/i }));
    await user.click(screen.getByRole('button', { name: /start import \(1\)/i }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        table: 'inventory',
        id: 'item-existing-1',
        payload: expect.objectContaining({
          qty: 0,
          condition: 'repair',
          remarks: 'Updated via backup',
        }),
      })
    );

    const histInsert = insertCalls.find((c) => c.table === 'history_log');
    const histRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    const itemData = histRow.item_data as {
      insertedIds: string[];
      updatedItems: Array<{ id: string; prev_data: Record<string, unknown> }>;
    };
    expect(itemData.insertedIds).toEqual([]);
    expect(itemData.updatedItems).toHaveLength(1);
    expect(itemData.updatedItems[0].id).toBe('item-existing-1');
    expect('qty_on_loan' in itemData.updatedItems[0].prev_data).toBe(false);
    expect('activeLoans' in itemData.updatedItems[0].prev_data).toBe(false);
  });

  it('preserves image_filename and omitted columns when updating from a partial or exported CSV', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const queryClient = createTestQueryClient();

    const existingWithPhotos: EnrichedInventoryItem[] = [
      {
        id: 'item-with-photos',
        category: 'Drums',
        category_id: 'cat-drums',
        subcategory_id: 'sub-snare',
        item: 'Pearl Brass Snare',
        brand: 'Pearl',
        qty: 2,
        condition: 'repair',
        owner: 'Church Property',
        location: 'Stage',
        location_id: 'loc-stage',
        serial: 'SN-200',
        description: 'Existing description',
        image_filename: '["https://cdn.example.com/snare-photo.jpg"]',
        remarks: 'Old remark',
        dateChecked: 'November 18, 2026',
        checked_at: '2026-11-18T09:00:00.000Z',
        checkedBy: 'Dan Caleb',
        qty_on_loan: 0,
        available_qty: 2,
        activeLoans: [],
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizardDialog
          open={true}
          onOpenChange={onOpenChange}
          items={existingWithPhotos}
          categories={[
            ...sampleCategories,
            {
              id: 'sub-snare',
              name: 'Snares',
              parent_id: 'cat-drums',
              color: '#d97740',
              icon: 'disc',
              sort_order: 11,
              created_at: '2026-11-18T00:00:00.000Z',
            },
          ]}
          locations={sampleLocations}
        />
      </QueryClientProvider>
    );

    const partialCsv = '"Equipment","Qty","Remarks"\r\n"Pearl Brass Snare","0","Updated remark only"';
    const fileInput = screen.getByLabelText(/select csv or json file/i);
    fireEvent.change(fileInput, {
      target: { files: [new File([partialCsv], 'partial.csv', { type: 'text/csv' })] },
    });

    expect(await screen.findByText('Pearl Brass Snare')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /update existing matches/i }));
    await user.click(screen.getByRole('button', { name: /start import \(1\)/i }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    expect(updateCalls).toHaveLength(1);
    const updatePayload = updateCalls[0].payload;
    expect(updatePayload.qty).toBe(0);
    expect(updatePayload.remarks).toBe('Updated remark only');
    // Omitted fields must NOT be sent so photos, condition, brand, location, and subcategory stay intact
    expect('image_filename' in updatePayload).toBe(false);
    expect('condition' in updatePayload).toBe(false);
    expect('brand' in updatePayload).toBe(false);
    expect('owner' in updatePayload).toBe(false);
    expect('location' in updatePayload).toBe(false);
    expect('location_id' in updatePayload).toBe(false);
    expect('subcategory_id' in updatePayload).toBe(false);
    expect('description' in updatePayload).toBe(false);
  });

  it('preserves subcategory_id and activeLoans when importing a JSON backup and logs partial commits if loans insert fails', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    const categoriesWithSub: Category[] = [
      ...sampleCategories,
      {
        id: 'sub-snare',
        name: 'Snares',
        parent_id: 'cat-drums',
        color: '#d97740',
        icon: 'disc',
        sort_order: 11,
        created_at: '2026-11-18T00:00:00.000Z',
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizardDialog
          open={true}
          onOpenChange={onOpenChange}
          items={existingItems}
          categories={categoriesWithSub}
          locations={sampleLocations}
        />
      </QueryClientProvider>
    );

    const backupJson = JSON.stringify({
      exportDate: '2026-11-18T00:00:00.000Z',
      items: [
        {
          id: 'orig-1',
          item: 'Restored Brass Snare',
          category: 'Drums',
          category_id: 'cat-drums',
          subcategory_id: 'sub-snare',
          qty: 3,
          condition: 'working',
          location: 'Stage',
          image_filename: '["https://cdn.example.com/snare.jpg"]',
          activeLoans: [
            {
              id: 'loan-orig-1',
              item_id: 'orig-1',
              borrower_name: 'Joel Santos',
              borrower_contact: '09171234567',
              qty_loaned: 2,
              checked_out_at: '2026-11-15T10:00:00.000Z',
              due_date: '2026-11-25',
              returned_at: null,
              checked_out_by: 'Dan Caleb',
              returned_by: null,
              notes: 'Youth camp',
            },
          ],
        },
      ],
    });

    failInsertTables.set('loans', 'RLS policy blocked loans insert');

    const fileInput = screen.getByLabelText(/select csv or json file/i);
    fireEvent.change(fileInput, {
      target: {
        files: [new File([backupJson], 'backup.json', { type: 'application/json' })],
      },
    });

    expect(await screen.findByText('Restored Brass Snare')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start import \(1\)/i }));

    // Surfaces error alert and keeps dialog open
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/RLS policy blocked loans insert/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Inventory insert preserved subcategory_id and image_filename
    const invInsert = insertCalls.find((c) => c.table === 'inventory');
    const invRow = (invInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(invRow.subcategory_id).toBe('sub-snare');
    expect(invRow.image_filename).toBe('["https://cdn.example.com/snare.jpg"]');

    // Loan insert attempted with full activeLoans fields (qty_loaned: 2, contact, notes)
    const loanInsert = insertCalls.find((c) => c.table === 'loans');
    const loanRow = (loanInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(loanRow.borrower_name).toBe('Joel Santos');
    expect(loanRow.borrower_contact).toBe('09171234567');
    expect(loanRow.qty_loaned).toBe(2);
    expect(loanRow.notes).toBe('Youth camp');

    // Despite loans failure, committed inventory insert was STILL recorded in history_log and caches were invalidated
    const histInsert = insertCalls.find((c) => c.table === 'history_log');
    expect(histInsert).toBeDefined();
    const histRow = (histInsert?.payload as Array<Record<string, unknown>>)[0];
    expect(histRow.action).toBe('import');
    expect((histRow.item_data as { insertedIds: string[] }).insertedIds).toHaveLength(1);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.inventory('admin') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.history });
  });
});
