import { useState, type FormEvent } from 'react';
import { AlertCircle, KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { FormCardSkeleton } from '@/components/ui/skeleton';
import { PasswordInput } from '@/features/auth/PasswordInput';
import { useAuth } from '@/features/auth/useAuth';
import { BRAND } from '@/lib/branding';
import { supabase } from '@/lib/supabase';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, isLoading, dismissGateway, openAuthModal } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErrorMessage(error.message);
        return;
      }

      toast.success('Password updated successfully!');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to update password. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md shadow-modal">
        <CardHeader className="items-center text-center">
          <img
            src="/images/logo.svg"
            alt={BRAND.logoAlt}
            className="mb-3 size-14 rounded-full"
          />
          <p className="font-display text-lg font-bold leading-tight tracking-tight text-foreground">
            {BRAND.appName}
          </p>
          <p className="font-sans text-[11px] font-semibold tracking-wide text-primary">
            {BRAND.workspaceLabel}
          </p>
          <div className="my-2 h-px w-12 bg-border" aria-hidden="true" />
          <CardTitle className="font-display text-xl font-bold">
            Set New Password
          </CardTitle>
          <CardDescription>
            Choose a strong password for your {BRAND.churchShortName} team account.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <FormCardSkeleton label="Verifying reset session..." />
          ) : !user ? (
            <div className="space-y-4 text-center">
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-left text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Your password reset session is missing or expired. Please request a new reset
                  link.
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    dismissGateway();
                    navigate('/dashboard', { replace: true });
                    openAuthModal('forgot');
                  }}
                >
                  Request New Reset Link
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => navigate('/dashboard', { replace: true })}
                >
                  Back to Dashboard
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4" noValidate>
              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="reset-new-password">New Password</Label>
                <PasswordInput
                  id="reset-new-password"
                  name="password"
                  autoComplete="new-password"
                  enterKeyHint="next"
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="reset-confirm-password">Confirm Password</Label>
                <PasswordInput
                  id="reset-confirm-password"
                  name="confirm_password"
                  autoComplete="new-password"
                  enterKeyHint="done"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <Button type="submit" disabled={isSubmitting} className="w-full">
                  <KeyRound className="size-4" />
                  <span>{isSubmitting ? 'Updating...' : 'Update Password'}</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => navigate('/dashboard', { replace: true })}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
