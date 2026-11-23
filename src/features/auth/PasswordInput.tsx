import { useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'> & {
  toggleLabel?: string;
};

export function PasswordInput({
  className,
  toggleLabel,
  disabled,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  const label = toggleLabel ?? (visible ? 'Hide password' : 'Show password');

  return (
    <div className="relative">
      <Input
        {...props}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setVisible((prev) => !prev)}
        aria-label={label}
        aria-pressed={visible}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
