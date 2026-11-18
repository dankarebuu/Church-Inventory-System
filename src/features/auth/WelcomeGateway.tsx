import { Eye, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from './useAuth';

export function WelcomeGateway() {
  const { user, showGateway, dismissGateway, openAuthModal } = useAuth();

  if (!showGateway || user) {
    return null;
  }

  const handleLoginClick = () => {
    dismissGateway();
    openAuthModal('login');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-gateway-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-md"
    >
      <div className="w-full max-w-[400px] rounded-2xl border border-border bg-card px-7 py-9 text-center shadow-modal sm:px-10 sm:py-11">
        <img
          src="/images/logo.svg"
          alt="WINGMACC logo"
          className="mx-auto mb-5 block h-auto w-24 rounded-2xl"
        />

        <span className="tape mb-2.5 inline-block rounded-md bg-primary px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-primary-foreground">
          CHURCH PROPERTY INVENTORY LOG
        </span>

        <h1
          id="welcome-gateway-title"
          className="font-display mt-2 mb-1 text-3xl font-bold uppercase leading-tight text-foreground sm:text-4xl"
        >
          Band Inventory
        </h1>

        <p className="mb-7 font-mono text-xs text-muted-foreground sm:text-[13px]">
          Band Department Inventory System
        </p>

        <div className="flex flex-col items-stretch gap-3">
          <Button
            type="button"
            size="lg"
            onClick={handleLoginClick}
            className="h-auto min-h-10 w-full whitespace-normal py-2.5"
          >
            <KeyRound className="size-4" />
            <span>Login to Edit</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={dismissGateway}
            className="h-auto min-h-10 w-full whitespace-normal border border-border py-2.5"
          >
            <Eye className="size-4" />
            <span>Continue as Guest (View Only)</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
