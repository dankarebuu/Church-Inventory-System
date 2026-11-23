import { lazy, Suspense, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { PwaUpdatePrompt } from '@/components/layout/PwaUpdatePrompt';
import { PageShellSkeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { AuthModal } from '@/features/auth/AuthModal';
import { AuthProvider } from '@/features/auth/useAuth';
import { WelcomeGateway } from '@/features/auth/WelcomeGateway';

const ActivityPage = lazy(() =>
  import('@/pages/ActivityPage').then((m) => ({ default: m.ActivityPage }))
);
const CategoriesPage = lazy(() =>
  import('@/pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage }))
);
const ChecklistPage = lazy(() =>
  import('@/pages/ChecklistPage').then((m) => ({ default: m.ChecklistPage }))
);
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const InventoryPage = lazy(() =>
  import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage }))
);
const LoansPage = lazy(() =>
  import('@/pages/LoansPage').then((m) => ({ default: m.LoansPage }))
);
const ResetPasswordPage = lazy(() =>
  import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);
const TeamPage = lazy(() =>
  import('@/pages/TeamPage').then((m) => ({ default: m.TeamPage }))
);

function RouteLoadingFallback() {
  return (
    <div className="p-2 sm:p-0">
      <PageShellSkeleton label="Loading view..." />
    </div>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={`${location.pathname}${location.search}`}>
      <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppRoutes() {
  return (
    <>
      <Routes>
        <Route
          path="/reset-password"
          element={
            <LazyRoute>
              <ResetPasswordPage />
            </LazyRoute>
          }
        />
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <LazyRoute>
                <DashboardPage />
              </LazyRoute>
            }
          />
          <Route
            path="/inventory"
            element={
              <LazyRoute>
                <InventoryPage />
              </LazyRoute>
            }
          />
          <Route
            path="/categories"
            element={
              <LazyRoute>
                <CategoriesPage />
              </LazyRoute>
            }
          />
          <Route
            path="/checklist"
            element={
              <LazyRoute>
                <ChecklistPage />
              </LazyRoute>
            }
          />
          <Route
            path="/loans"
            element={
              <ProtectedRoute allowedRoles={['member', 'admin']}>
                <LazyRoute>
                  <LoansPage />
                </LazyRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute allowedRoles={['member', 'admin']}>
                <LazyRoute>
                  <ActivityPage />
                </LazyRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <LazyRoute>
                  <TeamPage />
                </LazyRoute>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>

      <WelcomeGateway />
      <AuthModal />
      <PwaUpdatePrompt />
      <Toaster />
    </>
  );
}

export function App({ queryClient: providedQueryClient }: { queryClient?: QueryClient } = {}) {
  const [defaultQueryClient] = useState(createAppQueryClient);
  const queryClient = providedQueryClient ?? defaultQueryClient;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
