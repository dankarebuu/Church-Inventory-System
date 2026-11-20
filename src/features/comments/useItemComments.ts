import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { trimOrNull } from '@/lib/utils';
import type { CommentTag, Database, ItemComment } from '@/types/database';

export const COMMENT_MAX_LENGTH = 2000;
export const COMMENT_TAGS = ['note', 'issue', 'repair', 'setup'] as const satisfies readonly CommentTag[];

const EMPTY_COMMENTS: ItemComment[] = [];
const EMPTY_COMMENT_COUNTS: Record<string, number> = {};

type ItemCommentInsert = Database['public']['Tables']['item_comments']['Insert'];
type ItemCommentUpdate = Database['public']['Tables']['item_comments']['Update'];

export interface AddCommentInput {
  body: string;
  tag?: CommentTag;
}

export interface UpdateCommentInput {
  id: string;
  body: string;
  tag: CommentTag;
}

export interface TogglePinCommentInput {
  id: string;
  pinned: boolean;
}

/**
 * Sorts comments with pinned notes first, then newest `created_at` descending.
 */
export function sortItemComments(comments: readonly ItemComment[]): ItemComment[] {
  return [...comments].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }

    const timeA = Date.parse(a.created_at);
    const timeB = Date.parse(b.created_at);
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }

    return b.created_at.localeCompare(a.created_at);
  });
}

function validateCommentBody(body: string): string {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed) {
    throw new Error('Note cannot be empty.');
  }
  if (trimmed.length > COMMENT_MAX_LENGTH) {
    throw new Error(`Note cannot exceed ${COMMENT_MAX_LENGTH} characters.`);
  }
  return trimmed;
}

function validateCommentTag(tag?: CommentTag): CommentTag {
  const resolved = tag ?? 'note';
  if (!(COMMENT_TAGS as readonly string[]).includes(resolved)) {
    throw new Error('Invalid note tag.');
  }
  return resolved;
}

async function fetchItemComments(itemId: string): Promise<ItemComment[]> {
  const { data, error } = await supabase
    .from('item_comments')
    .select('*')
    .eq('item_id', itemId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return sortItemComments(data ?? []);
}

async function fetchCommentCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('item_comments')
    .select('item_id');

  if (error) {
    throw new Error(error.message);
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    if (typeof row.item_id === 'string' && row.item_id.length > 0) {
      counts[row.item_id] = (counts[row.item_id] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Fetches formal notes/comments for a specific inventory item sorted by
 * `pinned DESC, created_at DESC`. Strictly disabled for Guests, blank IDs,
 * when `enabled` is false, or when Supabase is unconfigured.
 */
export function useItemComments(itemId: string | null, enabled = true) {
  const { role } = useAuth();
  const normalizedItemId = trimOrNull(itemId);
  const canQuery = Boolean(
    isSupabaseConfigured &&
      enabled &&
      normalizedItemId &&
      role !== 'guest' &&
      (role === 'member' || role === 'admin')
  );

  const query = useQuery<ItemComment[], Error>({
    queryKey: queryKeys.itemComments(normalizedItemId ?? ''),
    queryFn: () => fetchItemComments(normalizedItemId!),
    enabled: canQuery,
  });

  return {
    data: canQuery ? (query.data ?? EMPTY_COMMENTS) : EMPTY_COMMENTS,
    isLoading: canQuery ? query.isLoading : false,
    isFetching: canQuery ? query.isFetching : false,
    isSuccess: canQuery ? query.isSuccess : false,
    isError: canQuery ? query.isError : false,
    error: canQuery ? query.error : null,
    refetch: query.refetch,
  };
}

/**
 * Lightweight count query mapping `item_id -> total comment count` for
 * card/table badges. Fires zero requests for Guests or when disabled.
 */
export function useCommentCounts(enabled = true) {
  const { role } = useAuth();
  const canQuery = Boolean(
    isSupabaseConfigured &&
      enabled &&
      role !== 'guest' &&
      (role === 'member' || role === 'admin')
  );

  const query = useQuery<Record<string, number>, Error>({
    queryKey: queryKeys.commentCounts,
    queryFn: fetchCommentCounts,
    enabled: canQuery,
  });

  return {
    data: canQuery ? (query.data ?? EMPTY_COMMENT_COUNTS) : EMPTY_COMMENT_COUNTS,
    isLoading: canQuery ? query.isLoading : false,
    isFetching: canQuery ? query.isFetching : false,
    isSuccess: canQuery ? query.isSuccess : false,
    isError: canQuery ? query.isError : false,
    error: canQuery ? query.error : null,
    refetch: query.refetch,
  };
}

/**
 * Provides Member/Admin-guarded CRUD mutations (`addComment`, `updateComment`,
 * `deleteComment`) and Admin-only `togglePinComment` with query invalidation.
 */
export function useCommentMutations(itemId: string | null) {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const normalizedItemId = trimOrNull(itemId);

  const assertCanMemberMutate = useCallback(() => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }
    if (role !== 'member' && role !== 'admin') {
      throw new Error('Only authenticated band members or admins can manage equipment notes.');
    }
  }, [role]);

  const assertCanAdminPin = useCallback(() => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase is not configured.');
    }
    if (role !== 'admin') {
      throw new Error('Only administrators can pin or unpin notes.');
    }
  }, [role]);

  const invalidateComments = useCallback(async () => {
    await Promise.all([
      normalizedItemId
        ? queryClient.invalidateQueries({
            queryKey: queryKeys.itemComments(normalizedItemId),
          })
        : queryClient.invalidateQueries({ queryKey: ['item-comments'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.commentCounts }),
    ]);
  }, [normalizedItemId, queryClient]);

  const addMutation = useMutation<ItemComment, Error, AddCommentInput>({
    mutationFn: async (input) => {
      assertCanMemberMutate();

      if (!normalizedItemId) {
        throw new Error('Item ID is required to add a note.');
      }

      const trimmedBody = validateCommentBody(input.body);
      const resolvedTag = validateCommentTag(input.tag);

      const insertPayload: ItemCommentInsert = {
        item_id: normalizedItemId,
        tag: resolvedTag,
        body: trimmedBody,
      };

      const { data, error } = await supabase
        .from('item_comments')
        .insert([insertPayload])
        .select('*')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      await invalidateComments();
      return data;
    },
  });

  const updateMutation = useMutation<ItemComment, Error, UpdateCommentInput>({
    mutationFn: async (input) => {
      assertCanMemberMutate();

      const commentId = trimOrNull(input.id);
      if (!commentId) {
        throw new Error('Comment ID is required.');
      }

      const trimmedBody = validateCommentBody(input.body);
      const resolvedTag = validateCommentTag(input.tag);

      const updatePayload: ItemCommentUpdate = {
        body: trimmedBody,
        tag: resolvedTag,
      };

      const { data, error } = await supabase
        .from('item_comments')
        .update(updatePayload)
        .eq('id', commentId)
        .select('*')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      await invalidateComments();
      return data;
    },
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      assertCanMemberMutate();

      const commentId = trimOrNull(id);
      if (!commentId) {
        throw new Error('Comment ID is required.');
      }

      const { error } = await supabase
        .from('item_comments')
        .delete()
        .eq('id', commentId);

      if (error) {
        throw new Error(error.message);
      }

      await invalidateComments();
    },
  });

  const togglePinMutation = useMutation<ItemComment, Error, TogglePinCommentInput>({
    mutationFn: async (input) => {
      assertCanAdminPin();

      const commentId = trimOrNull(input.id);
      if (!commentId) {
        throw new Error('Comment ID is required.');
      }

      const { data, error } = await supabase
        .from('item_comments')
        .update({ pinned: Boolean(input.pinned) })
        .eq('id', commentId)
        .select('*')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      await invalidateComments();
      return data;
    },
  });

  const { mutateAsync: runAdd } = addMutation;
  const { mutateAsync: runUpdate } = updateMutation;
  const { mutateAsync: runDelete } = deleteMutation;
  const { mutateAsync: runTogglePin } = togglePinMutation;

  const addComment = useCallback(
    (input: AddCommentInput) => runAdd(input),
    [runAdd]
  );

  const updateComment = useCallback(
    (input: UpdateCommentInput) => runUpdate(input),
    [runUpdate]
  );

  const deleteComment = useCallback(
    (id: string) => runDelete(id),
    [runDelete]
  );

  const togglePinComment = useCallback(
    (input: TogglePinCommentInput) => runTogglePin(input),
    [runTogglePin]
  );

  const pendingCommentId = updateMutation.isPending
    ? updateMutation.variables?.id ?? null
    : deleteMutation.isPending
      ? deleteMutation.variables ?? null
      : togglePinMutation.isPending
        ? togglePinMutation.variables?.id ?? null
        : null;

  return {
    addComment,
    updateComment,
    deleteComment,
    togglePinComment,
    isAdding: addMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isTogglingPin: togglePinMutation.isPending,
    pendingCommentId,
  };
}
