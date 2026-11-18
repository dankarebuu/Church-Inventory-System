import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { AuthModal } from '@/features/auth/AuthModal';
import { AuthProvider } from '@/features/auth/useAuth';
import { WelcomeGateway } from '@/features/auth/WelcomeGateway';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { LoansPage } from '@/pages/LoansPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';

interface RoutePlaceholderProps {
  title: string;
  description: string;
  badge: string;
}

function RoutePlaceholder({ title, description, badge }: RoutePlaceholderProps) {
  return (
    <section className="mx-auto max-w-4xl">
      <Card className="shadow-card">
        <CardHeader>
          <span className="w-fit rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            {badge}
          </span>
          <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Workspace shell, role guards, and Realtime sync are active for this route.
          </p>
        </CardContent>
      </Card>
    </section>
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
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <RoutePlaceholder
                badge="Workspace Overview"
                title="Operations Dashboard"
                description="Equipment overview, flagged items, active loans, and category health."
              />
            }
          />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route
            path="/checklist"
            element={
              <RoutePlaceholder
                badge="Sunday Ops"
                title="Sunday Checklist"
                description="Shared live Sunday check-off and printable PDF checklist sheet."
              />
            }
          />
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
                <RoutePlaceholder
                  badge="Audit Trail"
                  title="Activity Log"
                  description="Searchable history of gear checks, updates, loans, and restorations."
                />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <RoutePlaceholder
                  badge="Admin Only"
                  title="Team Roles"
                  description="Manage Band Member and Admin access roles across team profiles."
                />
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
