import { useEffect, useId, useState } from 'react';
import {
  AlertCircle,
  Edit2,
  Loader2,
  MessageSquare,
  Pin,
  PinOff,
  RefreshCw,
  Send,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FeedListSkeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/useAuth';
import { cn, formatDisplayDate, getInitials } from '@/lib/utils';
import type { CommentTag, ItemComment } from '@/types/database';
import {
  COMMENT_MAX_LENGTH,
  sortItemComments,
  useCommentMutations,
  useItemComments,
} from './useItemComments';

export interface ItemCommentsSectionProps {
  itemId: string;
  isOffline?: boolean;
}

interface TagMeta {
  label: string;
  badgeClasses: string;
  activeButtonClasses: string;
}

export const COMMENT_TAG_META: Record<CommentTag, TagMeta> = {
  note: {
    label: 'Note',
    badgeClasses:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600/40 dark:bg-slate-800 dark:text-slate-200',
    activeButtonClasses:
      'border-slate-400 bg-slate-200/80 text-slate-900 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-50',
  },
  issue: {
    label: 'Issue',
    badgeClasses:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
    activeButtonClasses:
      'border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/25 dark:text-amber-200',
  },
  repair: {
    label: 'Repair',
    badgeClasses:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300',
    activeButtonClasses:
      'border-red-400 bg-red-100 text-red-900 dark:border-red-500/60 dark:bg-red-500/25 dark:text-red-200',
  },
  setup: {
    label: 'Setup Tip',
    badgeClasses:
      'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-300',
    activeButtonClasses:
      'border-teal-400 bg-teal-100 text-teal-900 dark:border-teal-500/60 dark:bg-teal-500/25 dark:text-teal-200',
  },
};

const TAG_OPTIONS: ReadonlyArray<{ value: CommentTag; label: string }> = [
  { value: 'note', label: COMMENT_TAG_META.note.label },
  { value: 'issue', label: COMMENT_TAG_META.issue.label },
  { value: 'repair', label: COMMENT_TAG_META.repair.label },
  { value: 'setup', label: COMMENT_TAG_META.setup.label },
];

function formatCommentTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return formatDisplayDate(iso);
  }
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function wasEdited(comment: ItemComment): boolean {
  const created = Date.parse(comment.created_at);
  const updated = Date.parse(comment.updated_at);
  if (Number.isFinite(created) && Number.isFinite(updated)) {
    return updated - created > 1000;
  }
  return Boolean(comment.updated_at && comment.updated_at !== comment.created_at);
}

interface TagSelectorProps {
  value: CommentTag;
  onChange: (tag: CommentTag) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

function TagSelector({
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Note tag',
}: TagSelectorProps) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
      {TAG_OPTIONS.map((option) => {
        const active = value === option.value;
        const meta = COMMENT_TAG_META[option.value];
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 font-sans text-[11px] font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? meta.activeButtonClasses
                : 'border-border bg-secondary/40 text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Formal, calm per-item notes & comment thread for authenticated band members
 * and admins. Renders `null` for Guests and fires zero queries.
 */
export function ItemCommentsSection({
  itemId,
  isOffline = false,
}: ItemCommentsSectionProps) {
  const { role, user } = useAuth();
  const isGuest = role === 'guest';
  const composerId = useId();

  const {
    data: rawComments,
    isLoading,
    isError,
    error,
    refetch,
  } = useItemComments(itemId, !isGuest);

  const {
    addComment,
    updateComment,
    deleteComment,
    togglePinComment,
    isAdding,
    isUpdating,
    isDeleting,
    pendingCommentId,
  } = useCommentMutations(itemId);

  const [draftBody, setDraftBody] = useState('');
  const [draftTag, setDraftTag] = useState<CommentTag>('note');
  const [composerError, setComposerError] = useState<string | null>(null);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editTag, setEditTag] = useState<CommentTag>('note');
  const [editError, setEditError] = useState<string | null>(null);

  const [pendingDeleteComment, setPendingDeleteComment] = useState<ItemComment | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setDraftBody('');
    setDraftTag('note');
    setComposerError(null);
    setEditingCommentId(null);
    setEditBody('');
    setEditTag('note');
    setEditError(null);
    setPendingDeleteComment(null);
    setDeleteError(null);
  }, [itemId]);

  if (isGuest) {
    return null;
  }

  const isAdmin = role === 'admin';
  const comments = sortItemComments(rawComments);
  const trimmedDraft = draftBody.trim();
  const canSubmitDraft = !isOffline && !isAdding && trimmedDraft.length > 0;

  const handleSubmitDraft = async () => {
    if (!canSubmitDraft) return;
    setComposerError(null);

    try {
      await addComment({
        body: draftBody,
        tag: draftTag,
      });
      setDraftBody('');
      setDraftTag('note');
      toast.success('Note added.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save note.';
      setComposerError(message);
      toast.error(message);
    }
  };

  const handleStartEdit = (comment: ItemComment) => {
    setEditingCommentId(comment.id);
    setEditBody(comment.body);
    setEditTag(comment.tag);
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditBody('');
    setEditTag('note');
    setEditError(null);
  };

  const handleSaveEdit = async (comment: ItemComment) => {
    if (isOffline || isUpdating || !editBody.trim()) return;
    setEditError(null);

    try {
      await updateComment({
        id: comment.id,
        body: editBody,
        tag: editTag,
      });
      setEditingCommentId(null);
      setEditBody('');
      setEditTag('note');
      toast.success('Note updated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update note.';
      setEditError(message);
      toast.error(message);
    }
  };

  const handleTogglePin = async (comment: ItemComment) => {
    if (!isAdmin || isOffline || pendingCommentId === comment.id) return;
    try {
      await togglePinComment({
        id: comment.id,
        pinned: !comment.pinned,
      });
      toast.success(comment.pinned ? 'Note unpinned.' : 'Note pinned to top.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to update pin state.';
      toast.error(message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteComment || isOffline || isDeleting) return;
    const target = pendingDeleteComment;
    setDeleteError(null);
    try {
      await deleteComment(target.id);
      if (editingCommentId === target.id) {
        handleCancelEdit();
      }
      setPendingDeleteComment(null);
      toast.success('Note deleted.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to delete note.';
      setDeleteError(message);
      toast.error(message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-sans text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Notes & Maintenance Log
        </h3>
        {comments.length > 0 && (
          <span className="font-sans text-xs tabular-nums text-muted-foreground">
            {comments.length} {comments.length === 1 ? 'note' : 'notes'}
          </span>
        )}
      </div>

      {isOffline && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          <span>You are offline. Notes cannot be added or edited until connection returns.</span>
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmitDraft();
        }}
        className="space-y-2.5 rounded-xl border border-border bg-secondary/25 p-3.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor={composerId}
            className="font-sans text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Add a Note
          </label>
          <TagSelector
            value={draftTag}
            onChange={setDraftTag}
            disabled={isOffline || isAdding}
            ariaLabel="New note tag"
          />
        </div>

        <Textarea
          id={composerId}
          name="note"
          aria-label="Add a note"
          enterKeyHint="send"
          value={draftBody}
          onChange={(event) => {
            setDraftBody(event.target.value);
            if (composerError) setComposerError(null);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              void handleSubmitDraft();
            }
          }}
          maxLength={COMMENT_MAX_LENGTH}
          disabled={isOffline || isAdding}
          placeholder="Add a setup tip, repair update, or condition observation..."
          className="min-h-[76px] resize-y bg-card"
        />

        {composerError && (
          <p role="alert" className="text-xs font-medium text-destructive">
            {composerError}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="font-sans text-xs tabular-nums text-muted-foreground">
            {draftBody.length} / {COMMENT_MAX_LENGTH}
          </span>
          <div className="flex items-center gap-2">
            <span className="hidden font-sans text-[11px] text-muted-foreground sm:inline">
              Ctrl+Enter to post
            </span>
            <Button type="submit" size="sm" disabled={!canSubmitDraft}>
              {isAdding ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-3.5" aria-hidden="true" />
              )}
              <span>{isAdding ? 'Posting...' : 'Post Note'}</span>
            </Button>
          </div>
        </div>
      </form>

      {/* Notes Feed */}
      {isLoading ? (
        <FeedListSkeleton label="Loading notes..." rows={2} compact />
      ) : isError ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">Unable to load notes</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {error?.message ?? 'An unexpected error occurred while loading notes.'}
              </p>
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-secondary/20 px-4 py-6 text-center">
          <MessageSquare className="size-5 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No notes logged yet</p>
          <p className="text-xs text-muted-foreground">
            Share setup tips, repair logs, or condition updates with the team.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {comments.map((comment) => {
            const tagMeta = COMMENT_TAG_META[comment.tag] ?? COMMENT_TAG_META.note;
            const isAuthor = Boolean(user?.id && comment.user_id === user.id);
            const canEdit = isAuthor;
            const canDelete = isAuthor || isAdmin;
            const canPin = isAdmin;
            const isEditing = editingCommentId === comment.id;
            const isRowPending = pendingCommentId === comment.id;

            return (
              <article
                key={comment.id}
                className={cn(
                  'rounded-xl border p-3.5 text-sm transition-colors',
                  comment.pinned
                    ? 'border-primary/40 bg-primary/[0.04]'
                    : 'border-border bg-card'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-[11px] font-semibold text-foreground"
                    >
                      {getInitials(comment.author_name)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold text-foreground">
                          {comment.author_name}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider',
                            tagMeta.badgeClasses
                          )}
                        >
                          {tagMeta.label}
                        </span>
                        {comment.pinned && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-wider text-primary">
                            <Pin className="size-2.5" aria-hidden="true" />
                            <span>Pinned</span>
                          </span>
                        )}
                      </div>
                      <p className="font-sans text-xs tabular-nums text-muted-foreground">
                        {formatCommentTimestamp(comment.created_at)}
                        {wasEdited(comment) ? ' · edited' : ''}
                      </p>
                    </div>
                  </div>

                  {!isEditing && (canPin || canEdit || canDelete) && (
                    <div className="flex shrink-0 items-center gap-1">
                      {canPin && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className={cn(
                            'size-7',
                            comment.pinned
                              ? 'text-primary hover:text-primary'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                          aria-label={comment.pinned ? 'Unpin note' : 'Pin note'}
                          title={comment.pinned ? 'Unpin note' : 'Pin note'}
                          disabled={isOffline || isRowPending}
                          onClick={() => void handleTogglePin(comment)}
                        >
                          {comment.pinned ? (
                            <PinOff className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Pin className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          aria-label="Edit note"
                          title="Edit note"
                          disabled={isOffline || isRowPending}
                          onClick={() => handleStartEdit(comment)}
                        >
                          <Edit2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          aria-label="Delete note"
                          title="Delete note"
                          disabled={isOffline || isRowPending}
                          onClick={() => {
                            setDeleteError(null);
                            setPendingDeleteComment(comment);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-3 space-y-2.5 border-t border-border/70 pt-3">
                    <TagSelector
                      value={editTag}
                      onChange={setEditTag}
                      disabled={isOffline || isUpdating}
                      ariaLabel="Edit note tag"
                    />
                    <Textarea
                      aria-label="Edit note"
                      value={editBody}
                      onChange={(event) => {
                        setEditBody(event.target.value);
                        if (editError) setEditError(null);
                      }}
                      onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                          event.preventDefault();
                          void handleSaveEdit(comment);
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          handleCancelEdit();
                        }
                      }}
                      maxLength={COMMENT_MAX_LENGTH}
                      disabled={isOffline || isUpdating}
                      className="min-h-[72px] resize-y text-sm"
                    />
                    {editError && (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {editError}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-sans text-xs tabular-nums text-muted-foreground">
                        {editBody.length} / {COMMENT_MAX_LENGTH}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isUpdating}
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isOffline || isUpdating || !editBody.trim()}
                          onClick={() => void handleSaveEdit(comment)}
                        >
                          {isUpdating ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : null}
                          <span>{isUpdating ? 'Saving...' : 'Save'}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                    {comment.body}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Delete Note Confirmation */}
      <AlertDialog
        open={Boolean(pendingDeleteComment)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isDeleting) {
            setPendingDeleteComment(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteComment && (
                <>
                  This will permanently delete this note by{' '}
                  <span className="font-semibold text-foreground">
                    {pendingDeleteComment.author_name}
                  </span>
                  . This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
            {deleteError && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {deleteError}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting || isOffline}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
              className="bg-destructive-fill text-destructive-foreground hover:bg-destructive-fill/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete Note'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
