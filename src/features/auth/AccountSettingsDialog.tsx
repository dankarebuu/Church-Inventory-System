import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import type { ProfileRecord } from '@/types/database';
import { PasswordInput } from './PasswordInput';
import { useAuth } from './useAuth';

export interface AccountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function readMetaString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function deriveInitialNames(
  profile: ProfileRecord | null,
  user: User | null
): { firstName: string; lastName: string } {
  const meta = user?.user_metadata ?? {};
  const fallbackFullName =
    readMetaString(meta.full_name) || readMetaString(meta.username);
  const spaceIndex = fallbackFullName.indexOf(' ');
  const fallbackFirst =
    spaceIndex > 0 ? fallbackFullName.slice(0, spaceIndex) : fallbackFullName;
  const fallbackLast =
    spaceIndex > 0 ? fallbackFullName.slice(spaceIndex + 1).trim() : '';

  return {
    firstName: profile?.first_name ?? (readMetaString(meta.first_name) || fallbackFirst),
    lastName: profile?.last_name ?? (readMetaString(meta.last_name) || fallbackLast),
  };
}

export function AccountSettingsDialog({
  open,
  onOpenChange,
}: AccountSettingsDialogProps) {
  const { user, profile, refreshProfile } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const initializedUserIdRef = useRef<string | null>(null);
  const latestAuthContextRef = useRef({ profile, user });
  latestAuthContextRef.current = { profile, user };
  const currentUserId = profile?.id ?? user?.id ?? null;

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        setNewPassword('');
        setConfirmPassword('');
        setErrorMessage(null);
        setIsSubmitting(false);
      }
      wasOpenRef.current = false;
      initializedUserIdRef.current = null;
      return;
    }

    const isOpening = !wasOpenRef.current;
    const userChanged = currentUserId !== initializedUserIdRef.current;
    if (!isOpening && !userChanged) {
      return;
    }

    wasOpenRef.current = true;
    initializedUserIdRef.current = currentUserId;

    const { profile: latestProfile, user: latestUser } = latestAuthContextRef.current;
    const initial = deriveInitialNames(latestProfile, latestUser);
    setFirstName(initial.firstName);
    setLastName(initial.lastName);
    setNewPassword('');
    setConfirmPassword('');
    setErrorMessage(null);
  }, [open, currentUserId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (!trimmedFirst) {
      setErrorMessage('First name is required.');
      return;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        setErrorMessage('New password must be at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setErrorMessage('Passwords do not match.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const fullName = `${trimmedFirst} ${trimmedLast}`.trim();
      const updates: {
        data: {
          first_name: string;
          last_name: string;
          username: string;
          full_name: string;
        };
        password?: string;
      } = {
        data: {
          first_name: trimmedFirst,
          last_name: trimmedLast,
          username: fullName,
          full_name: fullName,
        },
      };

      if (newPassword) {
        updates.password = newPassword;
      }

      const { error } = await supabase.auth.updateUser(updates);
      if (error) {
        setErrorMessage(error.message);
        return;
      }

      await refreshProfile();
      toast.success('Account settings updated!');
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to update account settings. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Account Settings</DialogTitle>
          <DialogDescription>
            Update your display name or optionally change your password.
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4" noValidate>
          {user?.email && (
            <div className="grid gap-1.5">
              <Label htmlFor="acc-email">Email Address</Label>
              <Input id="acc-email" type="email" value={user.email} disabled readOnly />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="acc-first-name">First Name</Label>
              <Input
                id="acc-first-name"
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="acc-last-name">Last Name</Label>
              <Input
                id="acc-last-name"
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="acc-new-password">New Password (Optional)</Label>
            <PasswordInput
              id="acc-new-password"
              autoComplete="new-password"
              placeholder="Leave blank to keep current password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          {newPassword.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="acc-confirm-password">Confirm New Password</Label>
              <PasswordInput
                id="acc-confirm-password"
                autoComplete="new-password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
