import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Navigate, Outlet } from 'react-router-dom';
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
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex min-h-[40vh] items-center justify-center p-6"
      >
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-card">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
          <span>Verifying workspace access...</span>
        </div>
      </div>
    );
  }

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children !== undefined ? children : <Outlet />}</>;
}
