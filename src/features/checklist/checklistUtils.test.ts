import { describe, expect, it } from 'vitest';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, EquipmentType, LocationRecord } from '@/types/database';
import {
  computeChecklistProgress,
  filterChecklistItems,
  formatLocalYmd,
  groupChecklistItemsByCategory,
  isCheckedToday,
  toPrintableChecklistItem,
} from './checklistUtils';

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

describe('checklistUtils', () => {
  describe('isCheckedToday', () => {
    it('compares checked_at against local midnight boundaries regardless of time of day', () => {
      const ref = new Date(2026, 10, 22, 9, 15, 0);
      const justAfterMidnight = new Date(2026, 10, 22, 0, 0, 0, 0).toISOString();
      const lateNightSameDay = new Date(2026, 10, 22, 23, 59, 59, 999).toISOString();
      const oneMsBeforeMidnight = new Date(2026, 10, 21, 23, 59, 59, 999).toISOString();
      const nextDayMidnight = new Date(2026, 10, 23, 0, 0, 0, 0).toISOString();

      expect(isCheckedToday(justAfterMidnight, ref)).toBe(true);
      expect(isCheckedToday(lateNightSameDay, ref)).toBe(true);
      expect(isCheckedToday(oneMsBeforeMidnight, ref)).toBe(false);
      expect(isCheckedToday(nextDayMidnight, ref)).toBe(false);
    });

    it('handles timestamps whose local calendar day differs from their UTC calendar day', () => {
      const ref = new Date(2026, 10, 22, 8, 0, 0);
      const localDayStart = new Date(2026, 10, 22, 0, 30, 0);
      const localDayEnd = new Date(2026, 10, 22, 23, 30, 0);
      const prevLocalDayEnd = new Date(2026, 10, 21, 23, 30, 0);

      expect(isCheckedToday(localDayStart.toISOString(), ref)).toBe(true);
      expect(isCheckedToday(localDayEnd.toISOString(), ref)).toBe(true);
      expect(isCheckedToday(prevLocalDayEnd.toISOString(), ref)).toBe(false);
    });

    it('returns false for null, undefined, blank, or invalid checked_at values', () => {
      const ref = new Date(2026, 10, 22, 9, 15, 0);
      expect(isCheckedToday(null, ref)).toBe(false);
      expect(isCheckedToday(undefined, ref)).toBe(false);
      expect(isCheckedToday('   ', ref)).toBe(false);
      expect(isCheckedToday('invalid-timestamp', ref)).toBe(false);
    });
  });

  describe('computeChecklistProgress', () => {
    it('returns zeroes for an empty item list without NaN', () => {
      const ref = new Date(2026, 10, 22, 9, 15, 0);
      expect(computeChecklistProgress([], ref)).toEqual({
        checked: 0,
        total: 0,
        percent: 0,
      });
    });

    it('counts only items checked on referenceDate local day and rounds percentage', () => {
      const ref = new Date(2026, 10, 22, 10, 0, 0);
      const items = [
        { checked_at: new Date(2026, 10, 22, 7, 45, 0).toISOString() },
        { checked_at: new Date(2026, 10, 22, 0, 10, 0).toISOString() },
        { checked_at: new Date(2026, 10, 21, 23, 50, 0).toISOString() },
        { checked_at: null },
        { checked_at: new Date(2026, 10, 15, 11, 0, 0).toISOString() },
        { checked_at: new Date(2026, 10, 22, 9, 30, 0).toISOString() },
        { checked_at: undefined as unknown as null },
      ];

      expect(computeChecklistProgress(items, ref)).toEqual({
        checked: 3,
        total: 7,
        percent: 43,
      });
    });

    it('returns 100 percent when every item is checked today', () => {
      const ref = new Date(2026, 10, 22, 10, 0, 0);
      const items = [
        { checked_at: new Date(2026, 10, 22, 8, 0, 0).toISOString() },
        { checked_at: new Date(2026, 10, 22, 9, 0, 0).toISOString() },
      ];

      expect(computeChecklistProgress(items, ref)).toEqual({
        checked: 2,
        total: 2,
        percent: 100,
      });
    });
  });

  describe('filtering, grouping, and PII-free print projection', () => {
    const ref = new Date(2026, 10, 22, 10, 0, 0);
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
        dateChecked: 'November 22, 2026',
        checked_at: new Date(2026, 10, 22, 8, 0, 0).toISOString(),
        checkedBy: 'Dan Caleb',
        qty_on_loan: 1,
        available_qty: 1,
        equipment_type_id: null,
        equipment_type: null,
        min_qty: null,
        activeLoans: [
          {
            id: 'loan-1',
            item_id: 'item-snare',
            borrower_name: 'Joel Santos',
            borrower_contact: '09171234567',
            qty_loaned: 1,
            checked_out_at: '2026-11-20T10:00:00.000Z',
            due_date: '2026-11-25',
            returned_at: null,
            checked_out_by: 'Dan Caleb',
            returned_by: null,
            notes: 'Youth camp',
          },
        ],
      },
      {
        id: 'item-zero-cable',
        category: 'Spares & Shared',
        category_id: 'cat-spares',
        subcategory_id: null,
        item: 'Spare TRS Cable',
        brand: null,
        qty: 0,
        condition: 'missing',
        owner: 'Band Team',
        location: 'Booth',
        location_id: 'loc-booth',
        serial: null,
        description: null,
        image_filename: null,
        remarks: 'Out of stock',
        dateChecked: null,
        checked_at: null,
        checkedBy: 'Eli Cruz',
        qty_on_loan: 0,
        available_qty: 0,
        equipment_type_id: null,
        equipment_type: null,
        min_qty: null,
        activeLoans: [],
      },
    ];

    it('filters by category, location, uncheckedOnly, and groups by category sort_order', () => {
      const onlyBooth = filterChecklistItems(sampleItems, {
        locationId: 'loc-booth',
        categories: sampleCategories,
        locations: sampleLocations,
        referenceDate: ref,
      });
      expect(onlyBooth.map((i) => i.id)).toEqual(['item-zero-cable']);

      const onlyUnchecked = filterChecklistItems(sampleItems, {
        uncheckedOnly: true,
        categories: sampleCategories,
        locations: sampleLocations,
        referenceDate: ref,
      });
      expect(onlyUnchecked.map((i) => i.id)).toEqual(['item-zero-cable']);

      const groups = groupChecklistItemsByCategory(sampleItems, sampleCategories);
      expect(groups.map((g) => g.label)).toEqual(['Drums', 'Spares & Shared']);
      expect(groups[0].color).toBe('#d97740');
    });

    it('creates printable item projections without borrower PII or checkedBy while keeping qty = 0', () => {
      const printableSnare = toPrintableChecklistItem(
        sampleItems[0],
        sampleCategories,
        sampleLocations
      );
      const printableZero = toPrintableChecklistItem(
        sampleItems[1],
        sampleCategories,
        sampleLocations
      );

      expect(printableSnare).toEqual({
        id: 'item-snare',
        item: 'Pearl Brass Snare',
        categoryName: 'Drums',
        subcategoryName: 'Snares',
        categoryColor: '#d97740',
        brand: 'Pearl',
        qty: 2,
        qtyOnLoan: 1,
        availableQty: 1,
        locationName: 'Stage',
        owner: 'Church Property',
        condition: 'working',
        serial: 'SN-100',
      });
      expect(printableZero.qty).toBe(0);
      expect('checkedBy' in printableSnare).toBe(false);
      expect('activeLoans' in printableSnare).toBe(false);
      expect(JSON.stringify(printableSnare)).not.toMatch(/Joel Santos|Dan Caleb|09171234567/);
    });

    it('excludes checkedBy from search unless includeCheckedByInSearch is enabled and formats local YYYY-MM-DD', () => {
      const guestSearch = filterChecklistItems(sampleItems, {
        search: 'Dan Caleb',
        categories: sampleCategories,
        locations: sampleLocations,
        includeCheckedByInSearch: false,
      });
      expect(guestSearch).toEqual([]);

      const memberSearch = filterChecklistItems(sampleItems, {
        search: 'Dan Caleb',
        categories: sampleCategories,
        locations: sampleLocations,
        includeCheckedByInSearch: true,
      });
      expect(memberSearch.map((i) => i.id)).toEqual(['item-snare']);

      expect(formatLocalYmd(new Date(2026, 10, 5, 23, 55, 0))).toBe('2026-11-05');
    });

    it('matches resolved category, equipment type, and location names when denormalized columns are stale or empty', () => {
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
      const staleItems: EnrichedInventoryItem[] = [
        {
          ...sampleItems[0],
          id: 'item-resolved',
          item: 'Wireless Capsule',
          category: 'Old Rig',
          category_id: 'cat-drums',
          location: 'Legacy Room',
          location_id: 'loc-stage',
          equipment_type_id: 'et-mics',
          equipment_type: null,
        },
      ];

      expect(
        filterChecklistItems(staleItems, {
          search: 'Drums',
          categories: sampleCategories,
          locations: sampleLocations,
          equipmentTypes: sampleEquipmentTypes,
        }).map((i) => i.id)
      ).toEqual(['item-resolved']);

      expect(
        filterChecklistItems(staleItems, {
          search: 'Microphones',
          categories: sampleCategories,
          locations: sampleLocations,
          equipmentTypes: sampleEquipmentTypes,
        }).map((i) => i.id)
      ).toEqual(['item-resolved']);

      expect(
        filterChecklistItems(staleItems, {
          search: 'Stage',
          categories: sampleCategories,
          locations: sampleLocations,
          equipmentTypes: sampleEquipmentTypes,
        }).map((i) => i.id)
      ).toEqual(['item-resolved']);
    });
  });
});
