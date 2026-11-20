import { Eye, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
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
          alt="WINGMACC logo"
          className="mx-auto mb-5 block h-auto w-24 rounded-2xl"
        />

        <span className="tape mx-auto mb-2.5 inline-block w-fit justify-self-center rounded-md bg-primary px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-primary-foreground">
          CHURCH PROPERTY INVENTORY LOG
        </span>

        <DialogTitle asChild>
          <h1 className="font-display mt-2 mb-1 text-3xl font-bold uppercase leading-tight text-foreground sm:text-4xl">
            Band Inventory
          </h1>
        </DialogTitle>

        <DialogDescription className="mb-7 font-mono text-xs text-muted-foreground sm:text-[13px]">
          Band Department Inventory System
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
