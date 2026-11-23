import { z } from 'zod';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidYmdDate(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function formatLocalYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const optionalNullableTrimmedString = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((val) => (val && val.length > 0 ? val : null));

const optionalDueDateSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((val, ctx) => {
    if (!val) return null;
    if (!isValidYmdDate(val)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Due date must be a valid YYYY-MM-DD date',
      });
      return z.NEVER;
    }
    return val;
  });

/**
 * Builds a Zod v4 checkout schema bounded by `maxAvailableQty`, parsing
 * numeric or trimmed string quantities into whole integers `1..maxAvailableQty`.
 */
export function createCheckoutSchema(maxAvailableQty: number) {
  const safeMax = Number.isFinite(maxAvailableQty)
    ? Math.max(0, Math.floor(maxAvailableQty))
    : 0;

  const qtyLoanedSchema = z
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
        .min(1, 'Quantity must be at least 1')
        .max(
          safeMax,
          safeMax <= 0
            ? 'No available units left to check out'
            : `Quantity cannot exceed ${safeMax} available`
        )
    );

  return z.object({
    item_id: z.string().trim().min(1, 'Please select an equipment item'),
    borrower_name: z.string().trim().min(1, 'Borrower name is required'),
    borrower_contact: optionalNullableTrimmedString,
    qty_loaned: qtyLoanedSchema,
    due_date: optionalDueDateSchema,
    notes: optionalNullableTrimmedString,
  });
}

export type CheckoutSchema = ReturnType<typeof createCheckoutSchema>;
export type CheckoutFormInput = z.input<CheckoutSchema>;
export type CheckoutFormValues = z.output<CheckoutSchema>;

/**
 * Checks whether an unreturned loan's `YYYY-MM-DD` due date is strictly
 * earlier than `today`'s local calendar `YYYY-MM-DD` date.
 */
export function isLoanOverdue(
  dueDate?: string | null,
  returnedAt?: string | null,
  today: Date = new Date()
): boolean {
  if (typeof returnedAt === 'string' ? returnedAt.trim().length > 0 : Boolean(returnedAt)) {
    return false;
  }
  if (typeof dueDate !== 'string') return false;
  const trimmedDue = dueDate.trim();
  if (!trimmedDue || !isValidYmdDate(trimmedDue)) return false;
  if (Number.isNaN(today.getTime())) return false;

  const todayLocalYmd = formatLocalYmd(today);
  return trimmedDue < todayLocalYmd;
}
