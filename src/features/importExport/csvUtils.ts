import {
  resolveEquipmentTypeName,
  resolveSubcategoryName,
} from '@/features/inventory/inventoryUi';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { BRAND } from '@/lib/branding';
import { formatDisplayDate, trimOrNull } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  HistoryEntry,
  ItemCondition,
  LoanRecord,
} from '@/types/database';

export interface ParsedImportLoan {
  id?: string;
  borrower_name: string;
  borrower_contact: string | null;
  qty_loaned: number;
  due_date: string | null;
  notes: string | null;
  checked_out_at?: string | null;
  checked_out_by?: string | null;
}

export type ImportFieldKey =
  | 'item'
  | 'category'
  | 'subcategory'
  | 'equipment_type'
  | 'brand'
  | 'qty'
  | 'min_qty'
  | 'condition'
  | 'owner'
  | 'location'
  | 'dateChecked'
  | 'checkedBy'
  | 'remarks'
  | 'serial'
  | 'description'
  | 'image_filename'
  | 'borrower'
  | 'returnDate';

export interface ParsedImportItem {
  item: string;
  category: string;
  subcategory: string | null;
  subcategory_id?: string | null;
  equipment_type: string | null;
  equipment_type_id?: string | null;
  brand: string | null;
  qty: number;
  min_qty: number | null;
  condition: ItemCondition;
  owner: string | null;
  location: string | null;
  dateChecked: string | null;
  checkedBy: string | null;
  remarks: string | null;
  serial: string | null;
  description: string | null;
  image_filename: string | null;
  borrower: string | null;
  returnDate: string | null;
  loans?: ParsedImportLoan[];
  providedFields: ImportFieldKey[];
}

export interface ExportOptions {
  download?: boolean;
  filename?: string;
  equipmentTypes?: readonly EquipmentType[];
}

interface HeaderFieldSpec {
  field: ImportFieldKey;
  exactAliases: readonly string[];
  fallbackMatch?: (normalizedHeader: string) => boolean;
}

const HEADER_FIELD_SPECS: readonly HeaderFieldSpec[] = [
  {
    field: 'equipment_type',
    exactAliases: ['equipment type', 'type', 'gear type', 'item type'],
    fallbackMatch: (h) => h.includes('equipment type') || h.includes('gear type'),
  },
  {
    field: 'item',
    exactAliases: ['item', 'equipment', 'item name', 'equipment name', 'gear', 'name'],
    fallbackMatch: (h) =>
      (h.includes('item') || h.includes('equipment')) && h !== 'item id' && h !== 'id',
  },
  {
    field: 'subcategory',
    exactAliases: ['subcategory', 'sub category', 'subcat', 'sub type'],
    fallbackMatch: (h) => h.includes('subcategory') || h.includes('sub category'),
  },
  {
    field: 'category',
    exactAliases: ['category', 'cat', 'group'],
    fallbackMatch: (h) => h.includes('category') && !h.includes('sub'),
  },
  {
    field: 'brand',
    exactAliases: ['brand', 'make', 'manufacturer', 'model'],
  },
  {
    field: 'min_qty',
    exactAliases: [
      'min qty',
      'min stock',
      'reorder level',
      'min quantity',
      'minimum qty',
      'minimum quantity',
      'minimum stock',
    ],
    fallbackMatch: (h) =>
      h.includes('min qty') || h.includes('min stock') || h.includes('reorder'),
  },
  {
    field: 'qty',
    exactAliases: ['qty', 'quantity', 'count', 'units', 'stock'],
  },
  {
    field: 'condition',
    exactAliases: ['condition', 'status', 'state'],
  },
  {
    field: 'owner',
    exactAliases: ['owner', 'ownership'],
  },
  {
    field: 'location',
    exactAliases: ['location', 'storage', 'storage location', 'room', 'area'],
  },
  {
    field: 'returnDate',
    exactAliases: ['return date', 'returndate', 'due date', 'duedate', 'expected return'],
  },
  {
    field: 'dateChecked',
    exactAliases: ['date checked', 'datechecked', 'checked date', 'last checked'],
  },
  {
    field: 'checkedBy',
    exactAliases: ['checked by', 'checkedby', 'inspector'],
  },
  {
    field: 'remarks',
    exactAliases: ['remarks', 'remark', 'notes', 'note', 'comment', 'comments'],
  },
  {
    field: 'borrower',
    exactAliases: ['borrower', 'borrower name', 'checked out to', 'lent to'],
  },
  {
    field: 'serial',
    exactAliases: ['serial', 'serial number', 'serial no', 's/n', 'sn'],
  },
  {
    field: 'description',
    exactAliases: ['description', 'desc', 'details'],
  },
  {
    field: 'image_filename',
    exactAliases: ['image', 'images', 'image filename', 'image_filename', 'photo', 'photos'],
  },
];

const YMD_SLASH_OR_DASH_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const MDY_SLASH_OR_DASH_PATTERN = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
const ISO_TIMESTAMP_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T/;
const NUMERIC_ONLY_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;
const FOUR_DIGIT_YEAR_PATTERN = /\b\d{4}\b/;
const NAMED_MONTH_DAY_YEAR_PATTERN = /^[A-Za-z]+\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i;
const DAY_NAMED_MONTH_YEAR_PATTERN = /^(\d{1,2})(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+(\d{4})$/i;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeHeader(header: string): string {
  return stripBom(header)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function formatLocalYmd(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeValidatedLocalDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/**
 * Parses RFC-4180 CSV text supporting quoted commas, escaped `""` quotes,
 * embedded newlines, CRLF/LF/CR endings, and UTF-8 BOM headers.
 */
export function parseCSV(text: string): string[][] {
  const cleanText = stripBom(text);
  const lines: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }
      row.push(current.trim());
      if (row.some((cell) => cell !== '')) {
        lines.push(row);
      }
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell !== '')) {
      lines.push(row);
    }
  }

  return lines;
}

function normalizeImportCondition(raw: unknown): ItemCondition {
  if (typeof raw !== 'string') return 'working';
  const normalized = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (
    normalized === 'repair' ||
    normalized === 'needs repair' ||
    normalized === 'fix' ||
    normalized === 'broken' ||
    normalized === 'damaged'
  ) {
    return 'repair';
  }
  if (normalized === 'missing' || normalized === 'lost') {
    return 'missing';
  }
  return 'working';
}

function parseImportQty(raw: unknown, rowNumber: number): number {
  if (raw === null || raw === undefined) return 1;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) {
      throw new Error(
        `Row ${rowNumber}: Invalid quantity "${String(raw)}". Expected a non-negative whole number.`
      );
    }
    return Math.trunc(raw);
  }
  if (typeof raw !== 'string') return 1;

  const trimmed = raw.trim();
  if (trimmed === '') return 1;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Row ${rowNumber}: Invalid quantity "${trimmed}". Expected a non-negative whole number.`
    );
  }
  return parsed === 0 ? 0 : parsed;
}

function parseImportMinQty(raw: unknown, rowNumber: number): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
      throw new Error(
        `Row ${rowNumber}: Invalid min qty "${String(raw)}". Expected a non-negative whole number.`
      );
    }
    return raw === 0 ? 0 : raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      throw new Error(
        `Row ${rowNumber}: Invalid min qty "${trimmed}". Expected a non-negative whole number.`
      );
    }
    return parsed === 0 ? 0 : parsed;
  }

  throw new Error(
    `Row ${rowNumber}: Invalid min qty "${String(raw)}". Expected a non-negative whole number.`
  );
}

function resolveHeaderColumnMap(
  rawHeaders: readonly string[]
): Partial<Record<ImportFieldKey, number>> {
  const normalizedHeaders = rawHeaders.map(normalizeHeader);
  const columnMap: Partial<Record<ImportFieldKey, number>> = {};
  const claimedColumns = new Set<number>();

  // Pass 1: exact alias matching in priority order so e.g. "Equipment"/"Item" wins over generic "Name".
  for (const spec of HEADER_FIELD_SPECS) {
    let idx = -1;
    for (const alias of spec.exactAliases) {
      idx = normalizedHeaders.findIndex(
        (header, colIdx) => !claimedColumns.has(colIdx) && header === alias
      );
      if (idx !== -1) break;
    }
    if (idx !== -1) {
      columnMap[spec.field] = idx;
      claimedColumns.add(idx);
    }
  }

  // Pass 2: unambiguous substring fallbacks for remaining fields.
  for (const spec of HEADER_FIELD_SPECS) {
    if (columnMap[spec.field] !== undefined || !spec.fallbackMatch) continue;
    const idx = normalizedHeaders.findIndex(
      (header, colIdx) => !claimedColumns.has(colIdx) && spec.fallbackMatch!(header)
    );
    if (idx !== -1) {
      columnMap[spec.field] = idx;
      claimedColumns.add(idx);
    }
  }

  return columnMap;
}

/**
 * Maps parsed CSV rows by normalized, case-insensitive column headers regardless
 * of column order, preserving `qty = 0` and optional `Borrower` / `Return Date`.
 */
export function mapCsvRowsByHeader(rows: readonly (readonly string[])[]): ParsedImportItem[] {
  if (rows.length === 0) {
    throw new Error('CSV file is empty or missing headers.');
  }

  const columnMap = resolveHeaderColumnMap(rows[0]);
  if (columnMap.item === undefined) {
    throw new Error(
      'Invalid CSV structure. Header must contain an "Item" or "Equipment" column.'
    );
  }

  const providedFields = (Object.keys(columnMap) as ImportFieldKey[]).filter(
    (field) => columnMap[field] !== undefined
  );

  const readCell = (row: readonly string[], field: ImportFieldKey): string | null => {
    const colIndex = columnMap[field];
    if (colIndex === undefined) return null;
    return trimOrNull(row[colIndex]);
  };

  const parsedItems: ParsedImportItem[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const itemName = readCell(row, 'item');
    if (!itemName) continue;

    const rawQty =
      columnMap.qty !== undefined ? row[columnMap.qty] : undefined;
    const rawMinQty =
      columnMap.min_qty !== undefined ? row[columnMap.min_qty] : undefined;

    parsedItems.push({
      item: itemName,
      category: readCell(row, 'category') ?? 'Others',
      subcategory: readCell(row, 'subcategory'),
      equipment_type: readCell(row, 'equipment_type'),
      brand: readCell(row, 'brand'),
      qty: parseImportQty(rawQty, i + 1),
      min_qty: parseImportMinQty(rawMinQty, i + 1),
      condition: normalizeImportCondition(readCell(row, 'condition')),
      owner: readCell(row, 'owner'),
      location: readCell(row, 'location'),
      dateChecked: readCell(row, 'dateChecked'),
      checkedBy: readCell(row, 'checkedBy'),
      remarks: readCell(row, 'remarks'),
      serial: readCell(row, 'serial'),
      description: readCell(row, 'description'),
      image_filename: readCell(row, 'image_filename'),
      borrower: readCell(row, 'borrower'),
      returnDate: readCell(row, 'returnDate'),
      providedFields,
    });
  }

  return parsedItems;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? trimOrNull(value) : null;
}

function normalizeJsonImages(value: unknown): string | null {
  if (Array.isArray(value)) {
    const cleaned = value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim());
    return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
  }
  return asOptionalString(value);
}

function extractActiveLoansFromJson(record: Record<string, unknown>): ParsedImportLoan[] {
  if (!Array.isArray(record.activeLoans)) return [];
  const parsed: ParsedImportLoan[] = [];

  for (const rawLoan of record.activeLoans) {
    if (typeof rawLoan !== 'object' || rawLoan === null) continue;
    const loan = rawLoan as Record<string, unknown>;
    if (loan.returned_at != null) continue;
    const borrowerName = asOptionalString(loan.borrower_name);
    if (!borrowerName) continue;

    const rawLoanQty =
      typeof loan.qty_loaned === 'number'
        ? loan.qty_loaned
        : typeof loan.qty_loaned === 'string' && loan.qty_loaned.trim()
          ? Number(loan.qty_loaned)
          : 1;
    const qtyLoaned =
      Number.isFinite(rawLoanQty) && Number.isInteger(rawLoanQty) && rawLoanQty >= 1
        ? rawLoanQty
        : 1;

    parsed.push({
      ...(asOptionalString(loan.id) ? { id: asOptionalString(loan.id)! } : {}),
      borrower_name: borrowerName,
      borrower_contact: asOptionalString(loan.borrower_contact),
      qty_loaned: qtyLoaned,
      due_date: asOptionalString(loan.due_date),
      notes: asOptionalString(loan.notes),
      checked_out_at: asOptionalString(loan.checked_out_at),
      checked_out_by: asOptionalString(loan.checked_out_by),
    });
  }

  return parsed;
}

function collectJsonProvidedFields(record: Record<string, unknown>): ImportFieldKey[] {
  const has = (key: string) => key in record && record[key] !== undefined;
  const fields: ImportFieldKey[] = [];

  if (has('item') || has('equipment')) fields.push('item');
  if (has('category') || has('category_id')) fields.push('category');
  if (has('subcategory') || has('subcategory_id')) fields.push('subcategory');
  if (has('equipment_type') || has('equipment_type_id')) fields.push('equipment_type');
  if (has('brand')) fields.push('brand');
  if (has('qty')) fields.push('qty');
  if (has('min_qty')) fields.push('min_qty');
  if (has('condition') || has('status')) fields.push('condition');
  if (has('owner')) fields.push('owner');
  if (has('location') || has('location_id')) fields.push('location');
  if (has('dateChecked')) fields.push('dateChecked');
  if (has('checkedBy')) fields.push('checkedBy');
  if (has('remarks')) fields.push('remarks');
  if (has('serial')) fields.push('serial');
  if (has('description')) fields.push('description');
  if (has('image_filename')) fields.push('image_filename');
  if (has('borrower') || has('borrower_name') || has('activeLoans')) fields.push('borrower');
  if (has('returnDate') || has('due_date') || has('activeLoans')) fields.push('returnDate');

  return fields;
}

/**
 * Parses a WINGMACC JSON backup `{ items: [...] }` or raw item array into
 * normalized import rows while preserving `qty = 0`, `subcategory_id`,
 * `activeLoans`, and present field tracking.
 */
export function parseJsonImportPayload(
  jsonText: string,
  categories: readonly Category[] = [],
  equipmentTypes: readonly EquipmentType[] = []
): ParsedImportItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(jsonText));
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Invalid JSON syntax';
    throw new Error(`Invalid JSON file: ${reason}`);
  }

  let rawItems: unknown;
  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'items' in parsed &&
    Array.isArray((parsed as { items: unknown }).items)
  ) {
    rawItems = (parsed as { items: unknown[] }).items;
  } else {
    throw new Error('Invalid JSON format: Missing "items" array.');
  }

  const results: ParsedImportItem[] = [];
  for (let i = 0; i < (rawItems as unknown[]).length; i++) {
    const entry = (rawItems as unknown[])[i];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const itemName =
      asOptionalString(record.item) ?? asOptionalString(record.equipment);
    if (!itemName) continue;

    const categoryId = asOptionalString(record.category_id);
    const categoryFromText = asOptionalString(record.category);
    const categoryFromId = categoryId
      ? categories.find((c) => c.id === categoryId)?.name
      : undefined;
    const resolvedCategoryName = categoryFromText ?? categoryFromId ?? 'Others';

    const subcategoryId = asOptionalString(record.subcategory_id);
    const subcategoryFromText = asOptionalString(record.subcategory);
    const subcategoryFromId = subcategoryId
      ? categories.find((c) => c.id === subcategoryId)?.name
      : undefined;
    const resolvedSubcategoryName =
      subcategoryFromText ?? subcategoryFromId ?? null;

    const equipmentTypeId = asOptionalString(record.equipment_type_id);
    const equipmentTypeFromText = asOptionalString(record.equipment_type);
    const equipmentTypeFromId = equipmentTypeId
      ? equipmentTypes.find((et) => et.id === equipmentTypeId)?.name
      : undefined;
    const resolvedEquipmentTypeName =
      equipmentTypeFromId ?? equipmentTypeFromText ?? null;

    const activeLoans = extractActiveLoansFromJson(record);
    const flatBorrower =
      asOptionalString(record.borrower) ?? asOptionalString(record.borrower_name);
    const flatReturnDate =
      asOptionalString(record.returnDate) ?? asOptionalString(record.due_date);

    const borrowerSummary =
      activeLoans.length > 0
        ? activeLoans.map((l) => l.borrower_name).join('; ')
        : flatBorrower;
    const returnDateSummary =
      activeLoans.length > 0
        ? activeLoans
            .map((l) => l.due_date)
            .filter((d): d is string => Boolean(d))
            .join('; ') || null
        : flatReturnDate;

    results.push({
      item: itemName,
      category: resolvedCategoryName,
      subcategory: resolvedSubcategoryName,
      ...(subcategoryId ? { subcategory_id: subcategoryId } : {}),
      equipment_type: resolvedEquipmentTypeName,
      ...(equipmentTypeId ? { equipment_type_id: equipmentTypeId } : {}),
      brand: asOptionalString(record.brand),
      qty: parseImportQty(record.qty, i + 1),
      min_qty: parseImportMinQty(record.min_qty, i + 1),
      condition: normalizeImportCondition(record.condition ?? record.status),
      owner: asOptionalString(record.owner),
      location: asOptionalString(record.location),
      dateChecked: asOptionalString(record.dateChecked),
      checkedBy: asOptionalString(record.checkedBy),
      remarks: asOptionalString(record.remarks),
      serial: asOptionalString(record.serial),
      description: asOptionalString(record.description),
      image_filename: normalizeJsonImages(record.image_filename),
      borrower: borrowerSummary,
      returnDate: returnDateSummary,
      ...(activeLoans.length > 0 ? { loans: activeLoans } : {}),
      providedFields: collectJsonProvidedFields(record),
    });
  }

  return results;
}

/**
 * Best-effort parser converting spreadsheet return/due dates into Postgres
 * `YYYY-MM-DD`, preserving unparseable legacy text in `unparsedNote`.
 */
export function normalizeImportDueDate(raw?: string | null): {
  dueDate: string | null;
  unparsedNote: string | null;
} {
  const trimmed = trimOrNull(raw);
  if (!trimmed) {
    return { dueDate: null, unparsedNote: null };
  }

  const unparsedResult = {
    dueDate: null,
    unparsedNote: `Imported return date: ${trimmed}`,
  };

  if (NUMERIC_ONLY_PATTERN.test(trimmed)) {
    return unparsedResult;
  }

  const ymdMatch = YMD_SLASH_OR_DASH_PATTERN.exec(trimmed);
  if (ymdMatch) {
    const validDate = makeValidatedLocalDate(
      Number(ymdMatch[1]),
      Number(ymdMatch[2]),
      Number(ymdMatch[3])
    );
    return validDate
      ? { dueDate: formatLocalYmd(validDate), unparsedNote: null }
      : unparsedResult;
  }

  const mdyMatch = MDY_SLASH_OR_DASH_PATTERN.exec(trimmed);
  if (mdyMatch) {
    const validDate = makeValidatedLocalDate(
      Number(mdyMatch[3]),
      Number(mdyMatch[1]),
      Number(mdyMatch[2])
    );
    return validDate
      ? { dueDate: formatLocalYmd(validDate), unparsedNote: null }
      : unparsedResult;
  }

  const isoMatch = ISO_TIMESTAMP_PREFIX_PATTERN.exec(trimmed);
  if (isoMatch) {
    if (!makeValidatedLocalDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))) {
      return unparsedResult;
    }
    const parsedIso = new Date(trimmed);
    return !Number.isNaN(parsedIso.getTime())
      ? { dueDate: formatLocalYmd(parsedIso), unparsedNote: null }
      : unparsedResult;
  }

  if (!FOUR_DIGIT_YEAR_PATTERN.test(trimmed)) {
    return unparsedResult;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return unparsedResult;
  }

  const namedMatch =
    NAMED_MONTH_DAY_YEAR_PATTERN.exec(trimmed) ??
    DAY_NAMED_MONTH_YEAR_PATTERN.exec(trimmed);
  if (namedMatch) {
    const expectedDay = Number(namedMatch[1]);
    const expectedYear = Number(namedMatch[2]);
    if (parsed.getDate() !== expectedDay || parsed.getFullYear() !== expectedYear) {
      return unparsedResult;
    }
  }

  return { dueDate: formatLocalYmd(parsed), unparsedNote: null };
}

function triggerBrowserDownload(
  content: BlobPart,
  filename: string,
  mimeType: string
): void {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

const CSV_FORMULA_TRIGGER_PATTERN = /^[=+\-@\t\r]/;

function sanitizeCsvFormulaCell(value: string): string {
  return CSV_FORMULA_TRIGGER_PATTERN.test(value) ? `'${value}` : value;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const raw =
    typeof value === 'number' ? String(value) : sanitizeCsvFormulaCell(String(value));
  return `"${raw.replace(/"/g, '""')}"`;
}

/**
 * Serializes inventory items with active borrower details to RFC-4180 CSV
 * (preserving `qty = 0`), optionally triggering a UTF-8 BOM browser download.
 */
export function exportItemsToCSV(
  items: readonly EnrichedInventoryItem[],
  activeLoans: readonly LoanRecord[] = [],
  categories: readonly Category[] = [],
  options: ExportOptions = {}
): string {
  const loansByItemId = new Map<string, LoanRecord[]>();
  const seenLoanIds = new Set<string>();

  const pushLoan = (loan: LoanRecord) => {
    if (loan.returned_at != null) return;
    if (loan.id && seenLoanIds.has(loan.id)) return;
    if (loan.id) seenLoanIds.add(loan.id);
    const list = loansByItemId.get(loan.item_id) ?? [];
    list.push(loan);
    loansByItemId.set(loan.item_id, list);
  };

  for (const loan of activeLoans) {
    pushLoan(loan);
  }
  for (const item of items) {
    for (const loan of item.activeLoans ?? []) {
      pushLoan(loan);
    }
  }

  const headers = [
    'Category',
    'Subcategory',
    'Equipment Type',
    'Item',
    'Brand',
    'Qty',
    'Min Qty',
    'Condition',
    'Owner',
    'Location',
    'Date Checked',
    'Checked By',
    'Remarks',
    'Borrower',
    'Return Date',
    'Serial Number',
    'Description',
  ];

  const rows = items.map((item) => {
    const itemLoans = loansByItemId.get(item.id) ?? [];
    const borrowerText = itemLoans.map((l) => l.borrower_name).join('; ');
    const returnDateText = itemLoans
      .map((l) => trimOrNull(l.due_date))
      .filter((d): d is string => Boolean(d))
      .join('; ');
    const safeQty = Number.isFinite(item.qty) ? Math.max(item.qty, 0) : 0;
    const minQtyCell =
      item.min_qty !== null &&
      item.min_qty !== undefined &&
      Number.isFinite(item.min_qty)
        ? Math.max(Math.trunc(item.min_qty), 0)
        : '';
    const subName = resolveSubcategoryName(item, categories) ?? '';
    const equipmentTypeName =
      resolveEquipmentTypeName(item, options.equipmentTypes ?? []) ?? '';
    const checkedAtIso = trimOrNull(item.checked_at);
    const dateChecked = checkedAtIso
      ? formatDisplayDate(checkedAtIso)
      : (trimOrNull(item.dateChecked) ?? '');

    return [
      item.category,
      subName,
      equipmentTypeName,
      item.item,
      item.brand ?? '',
      safeQty,
      minQtyCell,
      item.condition,
      item.owner ?? '',
      item.location ?? '',
      dateChecked,
      item.checkedBy ?? '',
      item.remarks ?? '',
      borrowerText,
      returnDateText,
      item.serial ?? '',
      item.description ?? '',
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n');

  if (options.download !== false) {
    const filename =
      options.filename ?? `${BRAND.filePrefix}-inventory-${formatLocalYmd()}.csv`;
    triggerBrowserDownload(`\uFEFF${csv}`, filename, 'text/csv;charset=utf-8;');
  }

  return csv;
}

/**
 * Serializes full inventory items and audit history into a JSON backup
 * payload, optionally triggering a browser download.
 */
export function exportItemsToJSON(
  items: readonly EnrichedInventoryItem[],
  history: readonly HistoryEntry[] = [],
  options: ExportOptions = {}
): string {
  const totalUnits = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.qty) ? Math.max(item.qty, 0) : 0),
    0
  );

  const payload = {
    exportDate: new Date().toISOString(),
    items,
    history,
    stats: {
      totalItems: items.length,
      totalUnits,
    },
  };

  const json = JSON.stringify(payload, null, 2);

  if (options.download !== false) {
    const filename =
      options.filename ?? `${BRAND.filePrefix}-inventory-${formatLocalYmd()}.json`;
    triggerBrowserDownload(json, filename, 'application/json;charset=utf-8;');
  }

  return json;
}
