import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { createHistoryId, deriveActorName, trimOrNull } from '@/lib/utils';
import type { Database, LoanHistoryPayload, LoanRecord } from '@/types/database';
import { createCheckoutSchema, type CheckoutFormInput } from './schemas';

export interface CheckoutItemInput extends CheckoutFormInput {
  itemName?: string;
  maxAvailableQty?: number;
}

export interface ReturnLoanParams {
  loan: LoanRecord;
  itemName?: string;
}

export type ReturnLoanInput = LoanRecord | ReturnLoanParams;

type LoanInsert = Database['public']['Tables']['loans']['Insert'];
type HistoryInsert = Database['public']['Tables']['history_log']['Insert'];

const EMPTY_LOANS: LoanRecord[] = [];

async function fetchLoans(): Promise<LoanRecord[]> {
  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .order('checked_out_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function isReturnLoanParams(input: ReturnLoanInput): input is ReturnLoanParams {
  return typeof input === 'object' && input !== null && 'loan' in input;
}

/**
 * Provides Member/Admin-guarded loan check-out and check-in mutations,
 * logging `'loan'` audit entries and invalidating loans, inventory, and history caches.
 */
export function useLoanMutations() {
  const { role, user, profile } = useAuth();
  const queryClient = useQueryClient();

  const assertCanMutate = useCallback(() => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }
    if (role !== 'member' && role !== 'admin') {
      throw new Error('Only authenticated band members or admins can manage equipment loans.');
    }
  }, [role]);

  const invalidateLoanRelatedQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.loans }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(role) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.history }),
    ]);
  }, [queryClient, role]);

  const resolveItemNameFromCache = useCallback(
    (itemId: string, providedName?: string): string => {
      const explicit = trimOrNull(providedName);
      if (explicit) return explicit;
      const cachedInventory =
        queryClient.getQueryData<EnrichedInventoryItem[]>(queryKeys.inventory(role)) ?? [];
      const matched = cachedInventory.find((entry) => entry.id === itemId);
      return trimOrNull(matched?.item) ?? itemId;
    },
    [queryClient, role]
  );

  const checkoutMutation = useMutation<LoanRecord, Error, CheckoutItemInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const cachedInventory =
        queryClient.getQueryData<EnrichedInventoryItem[]>(queryKeys.inventory(role)) ?? [];
      const cachedItem = cachedInventory.find((entry) => entry.id === input.item_id);
      const maxAvailableQty =
        input.maxAvailableQty ?? cachedItem?.available_qty ?? Number.MAX_SAFE_INTEGER;

      const parsed = createCheckoutSchema(maxAvailableQty).parse(input);
      const nowIso = new Date().toISOString();
      const actorName = deriveActorName(profile, user);
      const actorEmail = user?.email ?? profile?.email ?? 'unknown';
      const resolvedItemName = resolveItemNameFromCache(parsed.item_id, input.itemName);

      const insertPayload: LoanInsert = {
        item_id: parsed.item_id,
        borrower_name: parsed.borrower_name,
        borrower_contact: parsed.borrower_contact,
        qty_loaned: parsed.qty_loaned,
        checked_out_at: nowIso,
        due_date: parsed.due_date,
        returned_at: null,
        checked_out_by: actorName,
        returned_by: null,
        notes: parsed.notes,
      };

      const { data: insertedLoan, error: insertError } = await supabase
        .from('loans')
        .insert([insertPayload])
        .select('*')
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      const historyPayload: LoanHistoryPayload = {
        actionType: 'checkout',
        item_id: parsed.item_id,
        item: resolvedItemName,
        ...(insertedLoan?.id ? { loan_id: insertedLoan.id } : {}),
        borrower_name: parsed.borrower_name,
        qty_loaned: parsed.qty_loaned,
        due_date: parsed.due_date,
        notes: parsed.notes,
      };

      const historyEntry: HistoryInsert = {
        id: createHistoryId(),
        action: 'loan',
        item_id: parsed.item_id,
        item_data: historyPayload,
        prev_data: null,
        user_email: actorEmail,
        undone: false,
        timestamp: nowIso,
      };

      const { error: historyError } = await supabase
        .from('history_log')
        .insert([historyEntry]);

      if (historyError) {
        await invalidateLoanRelatedQueries();
        throw new Error(historyError.message);
      }

      await invalidateLoanRelatedQueries();
      return (
        insertedLoan ?? {
          id: '',
          item_id: parsed.item_id,
          borrower_name: parsed.borrower_name,
          borrower_contact: parsed.borrower_contact,
          qty_loaned: parsed.qty_loaned,
          checked_out_at: nowIso,
          due_date: parsed.due_date,
          returned_at: null,
          checked_out_by: actorName,
          returned_by: null,
          notes: parsed.notes,
        }
      );
    },
  });

  const returnMutation = useMutation<LoanRecord, Error, ReturnLoanInput>({
    mutationFn: async (input) => {
      assertCanMutate();

      const loan = isReturnLoanParams(input) ? input.loan : input;
      const providedName = isReturnLoanParams(input) ? input.itemName : undefined;

      if (loan.returned_at != null) {
        throw new Error('This loan has already been returned.');
      }

      const nowIso = new Date().toISOString();
      const actorName = deriveActorName(profile, user);
      const actorEmail = user?.email ?? profile?.email ?? 'unknown';
      const resolvedItemName = resolveItemNameFromCache(loan.item_id, providedName);

      const { data: updatedLoan, error: updateError } = await supabase
        .from('loans')
        .update({
          returned_at: nowIso,
          returned_by: actorName,
        })
        .eq('id', loan.id)
        .is('returned_at', null)
        .select('*')
        .maybeSingle();

      if (updateError) {
        throw new Error(updateError.message);
      }

      if (!updatedLoan) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.loans }),
          queryClient.invalidateQueries({ queryKey: queryKeys.inventory(role) }),
        ]);
        throw new Error('This loan has already been returned.');
      }

      const historyPayload: LoanHistoryPayload = {
        actionType: 'return',
        item_id: loan.item_id,
        item: resolvedItemName,
        loan_id: loan.id,
        borrower_name: loan.borrower_name,
        qty_loaned: loan.qty_loaned,
        due_date: loan.due_date,
        returned_at: nowIso,
        notes: loan.notes,
      };

      const historyEntry: HistoryInsert = {
        id: createHistoryId(),
        action: 'loan',
        item_id: loan.item_id,
        item_data: historyPayload,
        prev_data: null,
        user_email: actorEmail,
        undone: false,
        timestamp: nowIso,
      };

      const { error: historyError } = await supabase
        .from('history_log')
        .insert([historyEntry]);

      if (historyError) {
        await invalidateLoanRelatedQueries();
        throw new Error(historyError.message);
      }

      await invalidateLoanRelatedQueries();
      return updatedLoan;
    },
  });

  const { mutateAsync: runCheckout } = checkoutMutation;
  const { mutateAsync: runReturn } = returnMutation;

  const checkoutItem = useCallback(
    (input: CheckoutItemInput) => runCheckout(input),
    [runCheckout]
  );

  const returnLoan = useCallback(
    (input: ReturnLoanInput) => runReturn(input),
    [runReturn]
  );

  return {
    checkoutItem,
    returnLoan,
    isCheckingOut: checkoutMutation.isPending,
    isReturning: returnMutation.isPending,
  };
}

/**
 * Fetches `public.loans` rows when `enabled` is true and the active role is
 * `'member'` or `'admin'`, ensuring Guests never query PII in `loans`.
 */
export function useLoans(enabled: boolean) {
  const { role } = useAuth();
  const canQueryLoans =
    enabled && isSupabaseConfigured && (role === 'member' || role === 'admin');

  const query = useQuery<LoanRecord[], Error>({
    queryKey: queryKeys.loans,
    queryFn: fetchLoans,
    enabled: canQueryLoans,
  });

  const loans = query.data ?? EMPTY_LOANS;

  const activeLoans = useMemo(
    () => loans.filter((loan) => loan.returned_at == null),
    [loans]
  );

  const returnedLoans = useMemo(
    () =>
      loans
        .filter((loan) => loan.returned_at != null)
        .sort((a, b) => (b.returned_at ?? '').localeCompare(a.returned_at ?? '')),
    [loans]
  );

  const mutations = useLoanMutations();

  return {
    loans,
    activeLoans,
    returnedLoans,
    isLoading: canQueryLoans ? query.isLoading : false,
    isError: canQueryLoans ? query.isError : false,
    error: canQueryLoans ? query.error : null,
    refetch: query.refetch,
    ...mutations,
  };
}
