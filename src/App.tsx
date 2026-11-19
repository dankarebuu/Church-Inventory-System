import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { Toaster } from '@/components/ui/sonner';
import { AuthModal } from '@/features/auth/AuthModal';
import { AuthProvider } from '@/features/auth/useAuth';
import { WelcomeGateway } from '@/features/auth/WelcomeGateway';
import { ActivityPage } from '@/pages/ActivityPage';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { ChecklistPage } from '@/pages/ChecklistPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { LoansPage } from '@/pages/LoansPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { TeamPage } from '@/pages/TeamPage';

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
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/checklist" element={<ChecklistPage />} />
          <Route
            path="/loans"
            element={
              <ProtectedRoute allowedRoles={['member', 'admin']}>
                <LoansPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute allowedRoles={['member', 'admin']}>
                <ActivityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <TeamPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>

      <WelcomeGateway />
      <AuthModal />
      <Toaster />
    </>
  );
}

export function App({ queryClient: providedQueryClient }: { queryClient?: QueryClient } = {}) {
  const [defaultQueryClient] = useState(createAppQueryClient);
  const queryClient = providedQueryClient ?? defaultQueryClient;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
