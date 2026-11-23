import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { PageShellSkeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/useAuth';
import type { UserRole } from '@/types/database';

export interface ProtectedRouteProps {
  allowedRoles: readonly UserRole[];
  children?: ReactNode;
}

/**
 * Role-based route guard that waits for initial auth hydration before
 * redirecting unauthorized users to `/dashboard`.
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { role, isLoading } = useAuth();

  if (isLoading) {
    return <PageShellSkeleton label="Verifying workspace access..." />;
  }

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children !== undefined ? children : <Outlet />}</>;
}
