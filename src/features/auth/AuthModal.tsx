import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { PasswordInput } from './PasswordInput';
import { useAuth, type AuthModalMode } from './useAuth';

export interface AuthModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type AuthErrorState =
  | { kind: 'restricted' }
  | { kind: 'message'; text: string }
  | null;

const MODE_COPY: Record<AuthModalMode, { title: string; description: string }> = {
  login: {
    title: 'Account Login',
    description: 'Sign in with your WINGMACC team account to check off gear and manage loans.',
  },
  signup: {
    title: 'Create Account',
    description: 'Register a band team account with your name and email address.',
  },
  forgot: {
    title: 'Reset Password',
    description: "Enter your email and we'll send you a secure reset link.",
  },
};

function isSignupRestrictedError(error: { message?: string; code?: string }): boolean {
  if (error.code === 'signup_disabled') return true;
  const lower = (error.message ?? '').toLowerCase();
  return lower.includes('signups not allowed') || lower.includes('disabled');
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const {
    isAuthModalOpen,
    closeAuthModal,
    authModalMode,
    setAuthModalMode,
  } = useAuth();

  const resolvedOpen = open ?? isAuthModalOpen;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorState, setErrorState] = useState<AuthErrorState>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!resolvedOpen) {
      setPassword('');
      setErrorState(null);
      setNoticeMessage(null);
      setIsSubmitting(false);
    }
  }, [resolvedOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeAuthModal();
    }
    onOpenChange?.(nextOpen);
  };

  const switchMode = (nextMode: AuthModalMode) => {
    setErrorState(null);
    setNoticeMessage(null);
    setPassword('');
    setAuthModalMode(nextMode);
  };

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorState({ kind: 'message', text: 'Email and password are required.' });
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorState({ kind: 'message', text: 'Please enter a valid email address.' });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      setErrorState({ kind: 'message', text: error.message });
      return;
    }

    toast.success('Logged in successfully');
    setEmail('');
    setPassword('');
    handleOpenChange(false);
  };

  const handleSignUp = async () => {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedFirst || !trimmedLast) {
      setErrorState({ kind: 'message', text: 'First name and last name are required.' });
      return;
    }

    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorState({ kind: 'message', text: 'Please enter a valid email address.' });
      return;
    }

    if (password.length < 6) {
      setErrorState({ kind: 'message', text: 'Password must be at least 6 characters.' });
      return;
    }

    const fullName = `${trimmedFirst} ${trimmedLast}`.trim();
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: {
          username: fullName,
          full_name: fullName,
          first_name: trimmedFirst,
          last_name: trimmedLast,
        },
      },
    });

    if (error) {
      if (isSignupRestrictedError(error as { message?: string; code?: string })) {
        setErrorState({ kind: 'restricted' });
      } else {
        setErrorState({ kind: 'message', text: error.message });
      }
      return;
    }

    if (data.session) {
      toast.success('Account created! Welcome.');
      setFirstName('');
      setLastName('');
      setEmail('');
      setPassword('');
      handleOpenChange(false);
      return;
    }

    setPassword('');
    setAuthModalMode('login');
    setNoticeMessage('Sign up successful! Check your email or log in.');
    toast.success('Sign up successful! You can now log in.');
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setErrorState({ kind: 'message', text: 'Please enter a valid email address.' });
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setErrorState({ kind: 'message', text: error.message });
      return;
    }

    setNoticeMessage('Reset link sent! Check your email inbox.');
    toast.success('Reset link sent! Check your email inbox.');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorState(null);
    setNoticeMessage(null);

    if (isSupabaseConfigured === false) {
      setErrorState({
        kind: 'message',
        text: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (authModalMode === 'login') {
        await handleLogin();
      } else if (authModalMode === 'signup') {
        await handleSignUp();
      } else {
        await handleForgotPassword();
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to reach authentication service. Please try again.';
      setErrorState({ kind: 'message', text: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copy = MODE_COPY[authModalMode];
  const unconfigured = isSupabaseConfigured === false;

  return (
    <Dialog open={resolvedOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {unconfigured && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-amber/30 bg-amber/10 p-3 text-xs text-foreground"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber" />
            <div>
              <p className="font-semibold">Supabase is not configured</p>
              <p className="mt-0.5 text-muted-foreground">
                Add <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
                <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in your environment
                before signing in.
              </p>
            </div>
          </div>
        )}

        {errorState?.kind === 'restricted' && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-sm text-foreground"
          >
            <p className="font-semibold text-destructive">Sign Up Restricted</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The email address used to sign up is{' '}
              <span className="font-semibold text-destructive">not permitted</span> by system
              policy. Please reach out to obtain access:
            </p>
            <div className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-foreground">
              <ShieldCheck className="size-4 shrink-0 text-primary" />
              <span>Contact Admin: Dan Caleb</span>
            </div>
          </div>
        )}

        {errorState?.kind === 'message' && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{errorState.text}</span>
          </div>
        )}

        {noticeMessage && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-foreground"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{noticeMessage}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4" noValidate>
          {authModalMode === 'signup' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="auth-first-name">First Name</Label>
                <Input
                  id="auth-first-name"
                  type="text"
                  autoComplete="given-name"
                  placeholder="e.g. Dan"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="auth-last-name">Last Name</Label>
                <Input
                  id="auth-last-name"
                  type="text"
                  autoComplete="family-name"
                  placeholder="e.g. Caleb"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="auth-email">Email Address</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@wingmacc.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {authModalMode !== 'forgot' && (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="auth-password">Password</Label>
                {authModalMode === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <PasswordInput
                id="auth-password"
                autoComplete={authModalMode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={
                  authModalMode === 'signup' ? 'Minimum 6 characters' : 'Enter your password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting
                ? authModalMode === 'forgot'
                  ? 'Sending...'
                  : 'Processing...'
                : authModalMode === 'login'
                  ? 'Login'
                  : authModalMode === 'signup'
                    ? 'Sign Up'
                    : 'Send Reset Link'}
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              {authModalMode === 'login' && (
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Need an account? Sign up
                </button>
              )}

              {authModalMode === 'signup' && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Already have an account? Login
                </button>
              )}

              {authModalMode === 'forgot' && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Back to Login
                </button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
