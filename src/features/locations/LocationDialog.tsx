import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import type { LocationRecord } from '@/types/database';
import { useLocationMutations } from './useLocations';

export interface LocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location?: LocationRecord | null;
}

/**
 * Admin modal for creating or editing storage locations (`name` and optional
 * `description`), surfacing validation and duplicate-name errors inline.
 */
export function LocationDialog({
  open,
  onOpenChange,
  location = null,
}: LocationDialogProps) {
  const { createLocation, updateLocation, isSaving } = useLocationMutations();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const initializedIdRef = useRef<string | null>(null);
  const targetKey = location?.id ?? 'new';

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      initializedIdRef.current = null;
      setSubmitError(null);
      return;
    }

    const isOpening = !wasOpenRef.current;
    const keyChanged = initializedIdRef.current !== targetKey;
    if (!isOpening && !keyChanged) {
      return;
    }

    wasOpenRef.current = true;
    initializedIdRef.current = targetKey;
    setName(location?.name ?? '');
    setDescription(location?.description ?? '');
    setSubmitError(null);
  }, [open, targetKey, location]);

  const isEditing = Boolean(location);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError('Location name is required.');
      return;
    }

    const trimmedDescription = description.trim();

    try {
      if (location) {
        await updateLocation({
          id: location.id,
          name: trimmedName,
          description: trimmedDescription || null,
          previousName: location.name,
        });
        toast.success(`Updated "${trimmedName}".`);
      } else {
        await createLocation({
          name: trimmedName,
          description: trimmedDescription || null,
        });
        toast.success(`Added "${trimmedName}".`);
      }
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to save storage location.';
      setSubmitError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Storage Location' : 'Add Storage Location'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update room or rack name and storage notes. Linked gear syncs automatically.'
              : 'Define a sanctuary room, cabinet, or rack where band gear is stored.'}
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="location-name-input">Location Name *</Label>
            <Input
              id="location-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Stage, Sound Booth, Backstage Closet"
              disabled={isSaving}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="location-description-input">Description</Label>
            <Textarea
              id="location-description-input"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Cabinet notes, access instructions, or rack details..."
              disabled={isSaving}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <span>{isEditing ? 'Save Changes' : 'Create Location'}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
