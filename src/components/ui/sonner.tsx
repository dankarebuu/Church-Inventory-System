import { useEffect, useState } from 'react';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

function readActiveTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function Toaster({ theme, toastOptions, ...props }: ToasterProps) {
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(readActiveTheme);

  useEffect(() => {
    if (theme || typeof document === 'undefined') return;
    const observer = new MutationObserver(() => {
      setResolvedTheme(readActiveTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [theme]);

  return (
    <SonnerToaster
      theme={theme ?? resolvedTheme}
      position="bottom-right"
      richColors
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast:
            'font-sans border border-border bg-card text-card-foreground shadow-modal rounded-xl',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-secondary text-secondary-foreground',
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
}
