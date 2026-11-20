import { zodResolver } from '@hookform/resolvers/zod';
import { describe, expect, it } from 'vitest';
import {
  itemFormSchema,
  MAX_GEAR_PHOTO_BYTES,
  MAX_GEAR_PHOTOS,
  validatePhotoFiles,
  type ItemFormInput,
} from './schemas';

describe('itemFormSchema', () => {
  const validBase = {
    item: 'Shure SM58 Microphone',
    category: 'Spares & Shared',
    category_id: 'cat-spares',
    subcategory_id: 'sub-mics',
    brand: 'Shure',
    qty: 2,
    condition: 'working' as const,
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-stage',
    serial: 'SM58-001',
    description: 'Dynamic vocal mic',
    remarks: 'Ready for Sunday',
  };

  it('keeps qty = 0 and string "0" valid without coercing to 1', () => {
    const parsedFromString = itemFormSchema.parse({ ...validBase, qty: '0' });
    expect(parsedFromString.qty).toBe(0);

    const parsedFromNumber = itemFormSchema.parse({ ...validBase, qty: 0 });
    expect(parsedFromNumber.qty).toBe(0);

    const parsedFromPadded = itemFormSchema.parse({ ...validBase, qty: ' 0 ' });
    expect(parsedFromPadded.qty).toBe(0);
  });

  it('accepts positive integer quantities as strings or numbers', () => {
    expect(itemFormSchema.parse({ ...validBase, qty: '14' }).qty).toBe(14);
    expect(itemFormSchema.parse({ ...validBase, qty: 7 }).qty).toBe(7);
  });

  it('rejects negative, fractional, empty, boolean, and non-numeric quantities', () => {
    const invalidQuantities: unknown[] = [
      -1,
      '-1',
      1.5,
      '2.5',
      '',
      '   ',
      'abc',
      null,
      undefined,
      true,
      false,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];

    for (const qty of invalidQuantities) {
      const result = itemFormSchema.safeParse({ ...validBase, qty });
      expect(result.success).toBe(false);
    }
  });

  it('requires non-empty item name and either category text or category_id', () => {
    expect(itemFormSchema.safeParse({ ...validBase, item: '   ' }).success).toBe(false);
    expect(
      itemFormSchema.safeParse({
        ...validBase,
        category: '',
        category_id: null,
      }).success
    ).toBe(false);

    const withIdOnly = itemFormSchema.safeParse({
      item: 'Monitor Wedge',
      category: '',
      category_id: 'cat-1',
      qty: '0',
    });
    expect(withIdOnly.success).toBe(true);
    if (withIdOnly.success) {
      expect(withIdOnly.data.qty).toBe(0);
      expect(withIdOnly.data.condition).toBe('working');
      expect(withIdOnly.data.subcategory_id).toBeNull();
      expect(withIdOnly.data.location_id).toBeNull();
    }
  });

  it('rejects invalid condition values and strips legacy borrower/returnDate fields', () => {
    expect(
      itemFormSchema.safeParse({ ...validBase, condition: 'broken' }).success
    ).toBe(false);

    const parsed = itemFormSchema.parse({
      ...validBase,
      borrower: 'John Doe',
      returnDate: '2026-12-01',
    });

    expect('borrower' in parsed).toBe(false);
    expect('returnDate' in parsed).toBe(false);
  });

  it('integrates cleanly with zodResolver and preserves qty = 0', async () => {
    const resolver = zodResolver(itemFormSchema);
    const input: ItemFormInput = {
      ...validBase,
      qty: '0',
    };

    const result = await resolver(input, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });

    expect(result.errors).toEqual({});
    expect(result.values.qty).toBe(0);
  });

  it('normalizes optional min_qty (blank/null/undefined -> null, 0/"0" -> 0) and rejects invalid values', () => {
    expect(itemFormSchema.parse({ ...validBase }).min_qty).toBeNull();
    expect(itemFormSchema.parse({ ...validBase, min_qty: '' }).min_qty).toBeNull();
    expect(itemFormSchema.parse({ ...validBase, min_qty: '   ' }).min_qty).toBeNull();
    expect(itemFormSchema.parse({ ...validBase, min_qty: null }).min_qty).toBeNull();
    expect(itemFormSchema.parse({ ...validBase, min_qty: undefined }).min_qty).toBeNull();

    expect(itemFormSchema.parse({ ...validBase, min_qty: 0 }).min_qty).toBe(0);
    expect(itemFormSchema.parse({ ...validBase, min_qty: '0' }).min_qty).toBe(0);
    expect(itemFormSchema.parse({ ...validBase, min_qty: ' 0 ' }).min_qty).toBe(0);
    expect(itemFormSchema.parse({ ...validBase, min_qty: '5' }).min_qty).toBe(5);
    expect(itemFormSchema.parse({ ...validBase, min_qty: 12 }).min_qty).toBe(12);

    const invalidMinQtys: unknown[] = [
      -1,
      '-1',
      1.5,
      '2.5',
      'abc',
      true,
      false,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (const min_qty of invalidMinQtys) {
      expect(itemFormSchema.safeParse({ ...validBase, min_qty }).success).toBe(false);
    }
  });

  it('normalizes equipment_type_id and equipment_type cleanly', () => {
    const emptyTypes = itemFormSchema.parse({
      ...validBase,
      equipment_type_id: '   ',
      equipment_type: null,
    });
    expect(emptyTypes.equipment_type_id).toBeNull();
    expect(emptyTypes.equipment_type).toBe('');

    const populatedTypes = itemFormSchema.parse({
      ...validBase,
      equipment_type_id: '  et-mics  ',
      equipment_type: '  Microphones  ',
    });
    expect(populatedTypes.equipment_type_id).toBe('et-mics');
    expect(populatedTypes.equipment_type).toBe('Microphones');
  });
});

describe('validatePhotoFiles', () => {
  function makeFile(name: string, type: string, sizeBytes = 1024): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: sizeBytes });
    return file;
  }

  it('accepts up to 4 total image files within the 5 MB limit', () => {
    const files = [
      makeFile('front.jpg', 'image/jpeg', MAX_GEAR_PHOTO_BYTES),
      makeFile('back.png', 'image/png', 250_000),
    ];

    expect(validatePhotoFiles(files, 2)).toEqual({ valid: true, error: null });
    expect(validatePhotoFiles([], 4)).toEqual({ valid: true, error: null });
  });

  it(`rejects when existing + new photos exceed ${MAX_GEAR_PHOTOS}`, () => {
    const oneFile = [makeFile('extra.png', 'image/png')];
    const resultFromExisting = validatePhotoFiles(oneFile, 4);
    expect(resultFromExisting.valid).toBe(false);
    expect(resultFromExisting.error).toMatch(/4/);

    const fiveFiles = [
      makeFile('1.png', 'image/png'),
      makeFile('2.png', 'image/png'),
      makeFile('3.png', 'image/png'),
      makeFile('4.png', 'image/png'),
      makeFile('5.png', 'image/png'),
    ];
    const resultFromBatch = validatePhotoFiles(fiveFiles, 0);
    expect(resultFromBatch.valid).toBe(false);
  });

  it('rejects non-image MIME types', () => {
    const pdf = makeFile('manual.pdf', 'application/pdf', 1024);
    const result = validatePhotoFiles([pdf], 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('manual.pdf');

    const emptyMime = makeFile('unknown', '', 1024);
    expect(validatePhotoFiles([emptyMime], 0).valid).toBe(false);
  });

  it('rejects files larger than 5 MB', () => {
    const oversized = makeFile('huge.png', 'image/png', MAX_GEAR_PHOTO_BYTES + 1);
    const result = validatePhotoFiles([oversized], 0);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('huge.png');
    expect(result.error).toMatch(/5\s*MB/i);
  });
});
