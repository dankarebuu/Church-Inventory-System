import { describe, expect, it } from 'vitest';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, HistoryEntry, LoanRecord } from '@/types/database';
import {
  exportItemsToCSV,
  exportItemsToJSON,
  mapCsvRowsByHeader,
  parseCSV,
  parseJsonImportPayload,
} from './csvUtils';

describe('parseCSV', () => {
  it('parses quoted commas, escaped quotes, embedded newlines, CRLF, and UTF-8 BOM', () => {
    const raw =
      '\uFEFF"Equipment","Category","Qty","Remarks"\r\n' +
      '"Snare, 14"" Brass","Drums",0,"Line 1\nLine 2, checked"\r\n' +
      '\r\n' +
      '"Shure SM58","Audio",2,"Ready"\r\n';

    const rows = parseCSV(raw);
    expect(rows).toEqual([
      ['Equipment', 'Category', 'Qty', 'Remarks'],
      ['Snare, 14" Brass', 'Drums', '0', 'Line 1\nLine 2, checked'],
      ['Shure SM58', 'Audio', '2', 'Ready'],
    ]);
  });

  it('returns an empty array for blank input', () => {
    expect(parseCSV('   \r\n  ')).toEqual([]);
  });
});

describe('mapCsvRowsByHeader', () => {
  it('maps reordered CSV columns with quoted commas, preserves qty=0, and reads optional Borrower & Return Date', () => {
    const csv =
      '"Equipment","Category","Qty","Remarks","Borrower","Return Date"\r\n' +
      '"Brass Snare, 14in","Drums","0","Needs new head, snare wire","Joel Santos","2026-11-25"\r\n' +
      '"XLR Cable, 20ft","Spares & Shared","4","Tested OK","",""\r\n';

    const rows = parseCSV(csv);
    const items = mapCsvRowsByHeader(rows);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        item: 'Brass Snare, 14in',
        category: 'Drums',
        qty: 0,
        condition: 'working',
        remarks: 'Needs new head, snare wire',
        borrower: 'Joel Santos',
        returnDate: '2026-11-25',
      })
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        item: 'XLR Cable, 20ft',
        category: 'Spares & Shared',
        qty: 4,
        remarks: 'Tested OK',
        borrower: null,
        returnDate: null,
      })
    );
  });

  it('matches headers case-insensitively and normalizes condition aliases & subcategories', () => {
    const rows = [
      ['serial_no', 'SUBCATEGORY', 'STATUS', 'Location', 'ITEM NAME', 'QTY'],
      ['SN-42', 'Snares', 'Needs Repair', 'Booth', 'Ludwig Black Beauty', '0'],
      ['SN-43', '', 'lost', 'Stage', 'Capo', ''],
    ];

    const items = mapCsvRowsByHeader(rows);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        item: 'Ludwig Black Beauty',
        category: 'Others',
        subcategory: 'Snares',
        condition: 'repair',
        location: 'Booth',
        serial: 'SN-42',
        qty: 0,
      })
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        item: 'Capo',
        condition: 'missing',
        location: 'Stage',
        qty: 1,
      })
    );
  });

  it('tracks providedFields strictly from CSV headers so omitted columns are identifiable', () => {
    const csv = '"Equipment","Qty","Remarks"\n"Snare","0","OK"';
    const items = mapCsvRowsByHeader(parseCSV(csv));
    expect(items[0].providedFields).toEqual(
      expect.arrayContaining(['item', 'qty', 'remarks'])
    );
    expect(items[0].providedFields).not.toContain('image_filename');
    expect(items[0].providedFields).not.toContain('brand');
    expect(items[0].providedFields).not.toContain('condition');
    expect(items[0].providedFields).not.toContain('location');
  });

  it('throws a clear validation error when CSV is missing an Item/Equipment header', () => {
    const rows = parseCSV('"Category","Brand","Qty","Remarks"\n"Drums","Pearl","2","OK"');
    expect(() => mapCsvRowsByHeader(rows)).toThrow(/item.*equipment/i);
  });

  it('throws a clear validation error for empty CSV or invalid negative quantity', () => {
    expect(() => mapCsvRowsByHeader([])).toThrow(/empty|header/i);

    const invalidQtyRows = parseCSV('"Equipment","Qty"\n"Mic","-2"');
    expect(() => mapCsvRowsByHeader(invalidQtyRows)).toThrow(/quantity/i);
  });
});

describe('parseJsonImportPayload', () => {
  it('parses backup JSON format and preserves qty = 0', () => {
    const payload = JSON.stringify({
      exportDate: '2026-11-18T00:00:00.000Z',
      items: [
        {
          item: 'Broken DI Box',
          category: 'Spares & Shared',
          qty: 0,
          condition: 'repair',
          borrower: 'Sam Lee',
          returnDate: '2026-11-30',
        },
      ],
    });

    const parsed = parseJsonImportPayload(payload);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].qty).toBe(0);
    expect(parsed[0].condition).toBe('repair');
    expect(parsed[0].borrower).toBe('Sam Lee');
    expect(parsed[0].returnDate).toBe('2026-11-30');
  });

  it('throws on invalid JSON structure missing items array', () => {
    expect(() => parseJsonImportPayload('{"foo": 123}')).toThrow(/items/i);
  });

  it('restores subcategory_id and activeLoans produced by exportItemsToJSON', () => {
    const categories: Category[] = [
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
    ];

    const exportedItem: EnrichedInventoryItem = {
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
      description: 'Brass snare',
      image_filename: '["https://cdn.example.com/snare.jpg"]',
      remarks: 'Tuned',
      dateChecked: 'November 18, 2026',
      checked_at: '2026-11-18T09:00:00.000Z',
      checkedBy: 'Dan Caleb',
      qty_on_loan: 2,
      available_qty: 0,
      activeLoans: [
        {
          id: 'loan-1',
          item_id: 'item-snare',
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
        {
          id: 'loan-old',
          item_id: 'item-snare',
          borrower_name: 'Returned Person',
          borrower_contact: null,
          qty_loaned: 1,
          checked_out_at: '2026-11-01T10:00:00.000Z',
          due_date: null,
          returned_at: '2026-11-05T10:00:00.000Z',
          checked_out_by: 'Dan Caleb',
          returned_by: 'Dan Caleb',
          notes: null,
        },
      ],
    };

    const jsonBackup = exportItemsToJSON([exportedItem], [], { download: false });
    const parsed = parseJsonImportPayload(jsonBackup, categories);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].subcategory_id).toBe('sub-snare');
    expect(parsed[0].subcategory).toBe('Snares');
    expect(parsed[0].image_filename).toBe('["https://cdn.example.com/snare.jpg"]');
    expect(parsed[0].loans).toEqual([
      expect.objectContaining({
        id: 'loan-1',
        borrower_name: 'Joel Santos',
        borrower_contact: '09171234567',
        qty_loaned: 2,
        due_date: '2026-11-25',
        notes: 'Youth camp',
      }),
    ]);
  });
});

describe('exportItemsToCSV & exportItemsToJSON', () => {
  const sampleItems: EnrichedInventoryItem[] = [
    {
      id: 'item-1',
      category: 'Drums',
      category_id: 'cat-drums',
      subcategory_id: null,
      item: 'Snare, Brass',
      brand: 'Pearl',
      qty: 0,
      condition: 'repair',
      owner: 'Church Property',
      location: 'Stage',
      location_id: 'loc-stage',
      serial: 'SN-1',
      description: '14" snare',
      image_filename: null,
      remarks: 'Needs head',
      dateChecked: 'November 18, 2026',
      checked_at: '2026-11-18T09:00:00.000Z',
      checkedBy: 'Dan Caleb',
      qty_on_loan: 1,
      available_qty: 0,
    },
  ];

  const activeLoans: LoanRecord[] = [
    {
      id: 'loan-1',
      item_id: 'item-1',
      borrower_name: 'Joel Santos',
      borrower_contact: null,
      qty_loaned: 1,
      checked_out_at: '2026-11-15T10:00:00.000Z',
      due_date: '2026-11-25',
      returned_at: null,
      checked_out_by: 'Dan Caleb',
      returned_by: null,
      notes: null,
    },
  ];

  it('exports CSV preserving qty=0, active loan borrower/due date, and round-trips through parseCSV', () => {
    const csv = exportItemsToCSV(sampleItems, activeLoans, [], { download: false });
    const parsedRows = parseCSV(csv);
    const reparsed = mapCsvRowsByHeader(parsedRows);

    expect(reparsed).toHaveLength(1);
    expect(reparsed[0]).toEqual(
      expect.objectContaining({
        item: 'Snare, Brass',
        category: 'Drums',
        brand: 'Pearl',
        qty: 0,
        condition: 'repair',
        location: 'Stage',
        borrower: 'Joel Santos',
        returnDate: '2026-11-25',
        serial: 'SN-1',
      })
    );
  });

  it('exports JSON backup with items, history, and accurate stats', () => {
    const history: HistoryEntry[] = [
      {
        id: 'h_1',
        action: 'added',
        item_id: 'item-1',
        item_data: { item: 'Snare, Brass' },
        prev_data: null,
        user_email: 'dan@wingmacc.org',
        undone: false,
        timestamp: '2026-11-18T09:00:00.000Z',
      },
    ];

    const jsonText = exportItemsToJSON(sampleItems, history, { download: false });
    const parsed = JSON.parse(jsonText) as {
      items: EnrichedInventoryItem[];
      history: HistoryEntry[];
      stats: { totalItems: number; totalUnits: number };
    };

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].qty).toBe(0);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.stats).toEqual({ totalItems: 1, totalUnits: 0 });
  });
});
