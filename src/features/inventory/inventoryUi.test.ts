import { describe, expect, it } from 'vitest';
import type { EquipmentType } from '@/types/database';
import { isLowStock, resolveEquipmentTypeName } from './inventoryUi';

const sampleTypes: EquipmentType[] = [
  {
    id: 'et-mics',
    name: 'Microphones',
    color: '#d3554a',
    icon: 'mic',
    sort_order: 90,
    created_at: '2026-11-20T00:00:00.000Z',
  },
  {
    id: 'et-cables',
    name: 'Cables & Cords',
    color: '#4e7fb0',
    icon: 'cable',
    sort_order: 60,
    created_at: '2026-11-20T00:00:00.000Z',
  },
];

describe('isLowStock', () => {
  it('returns false when min_qty is null or undefined', () => {
    expect(isLowStock({ qty: 0, min_qty: null })).toBe(false);
    expect(isLowStock({ qty: 0, min_qty: undefined })).toBe(false);
    expect(isLowStock({ qty: 5, min_qty: null })).toBe(false);
  });

  it('returns true when qty <= min_qty including min_qty = 0, and false when qty > min_qty', () => {
    expect(isLowStock({ qty: 0, min_qty: 0 })).toBe(true);
    expect(isLowStock({ qty: 1, min_qty: 0 })).toBe(false);
    expect(isLowStock({ qty: 2, min_qty: 3 })).toBe(true);
    expect(isLowStock({ qty: 3, min_qty: 3 })).toBe(true);
    expect(isLowStock({ qty: 4, min_qty: 3 })).toBe(false);
  });
});

describe('resolveEquipmentTypeName', () => {
  it('resolves by equipment_type_id first, falls back to equipment_type text, and returns null when unset', () => {
    expect(
      resolveEquipmentTypeName(
        { equipment_type_id: 'et-mics', equipment_type: 'Legacy Name' },
        sampleTypes
      )
    ).toBe('Microphones');

    expect(
      resolveEquipmentTypeName(
        { equipment_type_id: 'et-unknown', equipment_type: 'Cables & Cords' },
        sampleTypes
      )
    ).toBe('Cables & Cords');

    expect(
      resolveEquipmentTypeName(
        { equipment_type_id: null, equipment_type: '  Custom Hardware  ' },
        sampleTypes
      )
    ).toBe('Custom Hardware');

    expect(
      resolveEquipmentTypeName({ equipment_type_id: null, equipment_type: '   ' }, sampleTypes)
    ).toBeNull();
    expect(
      resolveEquipmentTypeName({ equipment_type_id: null, equipment_type: null }, sampleTypes)
    ).toBeNull();
  });
});
