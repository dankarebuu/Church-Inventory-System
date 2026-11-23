import type { QueryClient } from '@tanstack/react-query';
import type { UserRole } from '@/types/database';

export const queryKeys = {
  inventory: (role: UserRole) => ['inventory', role] as const,
  categories: ['categories'] as const,
  locations: ['locations'] as const,
  equipmentTypes: ['equipmentTypes'] as const,
  itemComments: (itemId: string) => ['item-comments', itemId] as const,
  commentCounts: ['item-comment-counts'] as const,
  loans: ['loans'] as const,
  history: ['history'] as const,
  profiles: ['profiles'] as const,
} as const;

/**
 * Removes all authenticated / PII-bearing TanStack Query caches (`loans`,
 * `history`, `profiles`, `item-comments`, `item-comment-counts`, and signed-in
 * `inventory` entries) so prior user data never lingers across sign-out or
 * account transitions.
 */
export function clearPrivateQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: queryKeys.inventory('member') });
  queryClient.removeQueries({ queryKey: queryKeys.inventory('admin') });
  queryClient.removeQueries({ queryKey: queryKeys.loans });
  queryClient.removeQueries({ queryKey: queryKeys.history });
  queryClient.removeQueries({ queryKey: queryKeys.profiles });
  queryClient.removeQueries({ queryKey: ['item-comments'] });
  queryClient.removeQueries({ queryKey: queryKeys.commentCounts });
}
