import { zodResolver } from '@hookform/resolvers/zod';
import { describe, expect, it } from 'vitest';
import {
  createCheckoutSchema,
  isLoanOverdue,
  type CheckoutFormInput,
} from './schemas';

describe('createCheckoutSchema', () => {
  const validBase: CheckoutFormInput = {
    item_id: 'item-snare',
    borrower_name: 'Joel Santos',
    borrower_contact: '09171234567',
    qty_loaned: 1,
    due_date: '2026-11-25',
    notes: 'Youth camp rehearsal',
  };

  it('accepts integer quantities from 1 up to maxAvailableQty (numbers and trimmed strings)', () => {
    const schema = createCheckoutSchema(2);

    const parsedOne = schema.parse({ ...validBase, qty_loaned: 1 });
    expect(parsedOne.qty_loaned).toBe(1);

    const parsedTwo = schema.parse({ ...validBase, qty_loaned: 2 });
    expect(parsedTwo.qty_loaned).toBe(2);

    const parsedStringOne = schema.parse({ ...validBase, qty_loaned: ' 1 ' });
    expect(parsedStringOne.qty_loaned).toBe(1);

    const parsedStringTwo = schema.parse({ ...validBase, qty_loaned: '2' });
    expect(parsedStringTwo.qty_loaned).toBe(2);
  });

  it('rejects qty_loaned: 0, values exceeding maxAvailableQty, blank strings, negatives, decimals, and non-numeric inputs', () => {
    const schema = createCheckoutSchema(2);
    const invalidQuantities: unknown[] = [
      0,
      '0',
      3,
      '3',
      -1,
      '-1',
      1.5,
      '1.5',
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

    for (const qty_loaned of invalidQuantities) {
      const result = schema.safeParse({ ...validBase, qty_loaned });
      expect(result.success).toBe(false);
    }
  });

  it('rejects any positive checkout quantity when maxAvailableQty is 0', () => {
    const schema = createCheckoutSchema(0);
    expect(schema.safeParse({ ...validBase, qty_loaned: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...validBase, qty_loaned: 0 }).success).toBe(false);
  });

  it('requires non-empty item_id and borrower_name, normalizes optional fields, and validates due_date', () => {
    const schema = createCheckoutSchema(3);

    expect(schema.safeParse({ ...validBase, item_id: '   ' }).success).toBe(false);
    expect(schema.safeParse({ ...validBase, borrower_name: '   ' }).success).toBe(false);
    expect(schema.safeParse({ ...validBase, due_date: 'not-a-date' }).success).toBe(false);
    expect(schema.safeParse({ ...validBase, due_date: '2026-02-30' }).success).toBe(false);

    const parsed = schema.parse({
      item_id: ' item-snare ',
      borrower_name: '  Joel Santos  ',
      borrower_contact: '   ',
      qty_loaned: '2',
      due_date: '',
      notes: undefined,
    });

    expect(parsed).toEqual({
      item_id: 'item-snare',
      borrower_name: 'Joel Santos',
      borrower_contact: null,
      qty_loaned: 2,
      due_date: null,
      notes: null,
    });
  });

  it('integrates with zodResolver for React Hook Form validation', async () => {
    const resolver = zodResolver(createCheckoutSchema(2));

    const okResult = await resolver(
      { ...validBase, qty_loaned: '2' },
      undefined,
      { fields: {}, shouldUseNativeValidation: false }
    );
    expect(okResult.errors).toEqual({});
    expect(okResult.values.qty_loaned).toBe(2);

    const failResult = await resolver(
      { ...validBase, qty_loaned: '3' },
      undefined,
      { fields: {}, shouldUseNativeValidation: false }
    );
    expect(failResult.errors.qty_loaned).toBeDefined();
  });
});

describe('isLoanOverdue', () => {
  const today = new Date(2026, 10, 18, 15, 30, 0); // 2026-11-18 local

  it('returns true when dueDate is strictly before today local calendar date and not returned', () => {
    expect(isLoanOverdue('2026-11-17', null, today)).toBe(true);
    expect(isLoanOverdue('2026-10-01', undefined, today)).toBe(true);
  });

  it('returns false when dueDate equals today local calendar date or is in the future', () => {
    expect(isLoanOverdue('2026-11-18', null, today)).toBe(false);
    expect(isLoanOverdue('2026-11-19', null, today)).toBe(false);
  });

  it('returns false when loan is already returned, dueDate is missing, or dueDate is invalid', () => {
    expect(isLoanOverdue('2026-11-17', '2026-11-18T08:00:00.000Z', today)).toBe(false);
    expect(isLoanOverdue(null, null, today)).toBe(false);
    expect(isLoanOverdue(undefined, null, today)).toBe(false);
    expect(isLoanOverdue('', null, today)).toBe(false);
    expect(isLoanOverdue('not-a-date', null, today)).toBe(false);
    expect(isLoanOverdue('2026-02-30', null, today)).toBe(false);
  });
});
