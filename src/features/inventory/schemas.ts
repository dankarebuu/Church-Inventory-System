import { z } from 'zod';

export const MAX_GEAR_PHOTOS = 4;
export const MAX_GEAR_PHOTO_BYTES = 5 * 1024 * 1024;

export const itemConditionSchema = z.enum(['working', 'repair', 'missing']);

const nullableOptionalId = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((val) => (val && val.length > 0 ? val : null));

const optionalTrimmedString = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((val) => val ?? '');

/**
 * Validates non-negative integer quantities without coercing `0` to `1`
 * and without accepting blank strings (`""`) as `0`.
 */
const nonNegativeIntQtySchema = z
  .union([z.number(), z.string()], { error: 'Quantity is required' })
  .transform((val, ctx) => {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '') {
        ctx.addIssue({
          code: 'custom',
          message: 'Quantity is required',
        });
        return z.NEVER;
      }
      const parsed = Number(trimmed);
      return parsed === 0 ? 0 : parsed;
    }
    return val === 0 ? 0 : val;
  })
  .pipe(
    z
      .number({ error: 'Quantity must be a whole number' })
      .int('Quantity must be a whole number')
      .min(0, 'Quantity cannot be negative')
  );

/**
 * Zod schema for Admin item creation and editing.
 * Legacy `borrower` and `returnDate` fields are intentionally excluded so
 * `public.loans` remains the single source of truth for check-outs.
 */
export const itemFormSchema = z
  .object({
    item: z.string().trim().min(1, 'Item name is required'),
    category: optionalTrimmedString,
    category_id: nullableOptionalId,
    subcategory_id: nullableOptionalId,
    brand: optionalTrimmedString,
    qty: nonNegativeIntQtySchema,
    condition: itemConditionSchema.default('working'),
    owner: optionalTrimmedString,
    location: optionalTrimmedString,
    location_id: nullableOptionalId,
    serial: optionalTrimmedString,
    description: optionalTrimmedString,
    remarks: optionalTrimmedString,
  })
  .superRefine((data, ctx) => {
    if (!data.category && !data.category_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['category'],
        message: 'Category is required',
      });
    }
  });

export type ItemFormInput = z.input<typeof itemFormSchema>;
export type ItemFormValues = z.output<typeof itemFormSchema>;

export const memberCheckSchema = z.object({
  itemId: z.string().trim().min(1, 'Item ID is required'),
  condition: itemConditionSchema,
  remarks: z.string().trim().nullable().optional(),
});

export type MemberCheckInput = z.infer<typeof memberCheckSchema>;

export interface PhotoValidationResult {
  valid: boolean;
  error: string | null;
}

/**
 * Validates image MIME type, 5 MB per-file size cap, and combined 4-photo limit
 * before uploading files to the `gear-photos` storage bucket.
 */
export function validatePhotoFiles(
  files: readonly File[],
  existingPhotoCount = 0
): PhotoValidationResult {
  const safeExistingCount = Math.max(0, existingPhotoCount);
  if (safeExistingCount + files.length > MAX_GEAR_PHOTOS) {
    return {
      valid: false,
      error: `Maximum of ${MAX_GEAR_PHOTOS} photos allowed per item.`,
    };
  }

  for (const file of files) {
    if (!file.type || !file.type.toLowerCase().startsWith('image/')) {
      return {
        valid: false,
        error: `"${file.name}" must be a valid image file.`,
      };
    }

    if (file.size > MAX_GEAR_PHOTO_BYTES) {
      return {
        valid: false,
        error: `"${file.name}" exceeds the 5 MB file size limit.`,
      };
    }
  }

  return { valid: true, error: null };
}
