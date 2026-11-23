import { Eye, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { BRAND } from '@/lib/branding';
import { useAuth } from './useAuth';

export function WelcomeGateway() {
  const { user, showGateway, dismissGateway, openAuthModal } = useAuth();

  const handleLoginClick = () => {
    dismissGateway();
    openAuthModal('login');
  };

  return (
    <Dialog
      open={Boolean(showGateway && !user)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dismissGateway();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-2rem)] max-w-[400px] gap-0 rounded-2xl px-7 py-9 text-center sm:px-10 sm:py-11"
      >
        <img
          src="/images/logo.svg"
          alt={BRAND.logoAlt}
          className="mx-auto mb-4 block size-20 rounded-full"
        />

        <DialogTitle asChild>
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
            {BRAND.appName}
          </h1>
        </DialogTitle>

        <p className="mt-1 font-sans text-xs font-semibold tracking-wide text-primary">
          {BRAND.workspaceLabel}
        </p>

        <DialogDescription className="mb-7 mt-3 space-y-0.5 font-sans text-xs text-muted-foreground sm:text-[13px]">
          <span className="block font-medium text-foreground/85">{BRAND.churchFullName}</span>
          <span className="block text-muted-foreground">{BRAND.churchTagline}</span>
        </DialogDescription>

        <div className="flex flex-col items-stretch gap-3">
          <Button
            type="button"
            size="lg"
            onClick={handleLoginClick}
            className="h-auto min-h-10 w-full whitespace-normal py-2.5"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            <span>Login to Edit</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={dismissGateway}
            className="h-auto min-h-10 w-full whitespace-normal border border-border py-2.5"
          >
            <Eye className="size-4" aria-hidden="true" />
            <span>Continue as Guest (View Only)</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
