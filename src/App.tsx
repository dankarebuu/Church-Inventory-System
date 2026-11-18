import { Toaster } from '@/components/ui/sonner';

export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center shadow-card">
        <img
          src="/images/logo.svg"
          alt="WINGMACC Band Inventory logo"
          className="size-14"
        />
        <h1 className="font-display text-2xl font-bold tracking-wide">
          WINGMACC
        </h1>
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Band Department Inventory
        </p>
      </div>
      <Toaster />
    </main>
  );
}

export default App;
