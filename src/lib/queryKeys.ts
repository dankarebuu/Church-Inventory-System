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
