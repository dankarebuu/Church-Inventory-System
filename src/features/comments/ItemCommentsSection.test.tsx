import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/features/auth/useAuth';
import type { ItemComment, UserRole } from '@/types/database';
import { ItemCommentsSection } from './ItemCommentsSection';

const mockUseAuth = vi.fn<() => AuthContextValue>();
const mockUseItemComments = vi.fn<
  (itemId: string | null, enabled?: boolean) => {
    data: ItemComment[];
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => void;
  }
>();
const mockRefetch = vi.fn();
const mockAddComment = vi.fn();
const mockUpdateComment = vi.fn();
const mockDeleteComment = vi.fn();
const mockTogglePinComment = vi.fn();

const mockMutationFlags = {
  isAdding: false,
  isUpdating: false,
  isDeleting: false,
  isTogglingPin: false,
  pendingCommentId: null as string | null,
};

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('./useItemComments', async () => {
  const actual = await vi.importActual<typeof import('./useItemComments')>('./useItemComments');
  return {
    ...actual,
    useItemComments: (itemId: string | null, enabled?: boolean) =>
      mockUseItemComments(itemId, enabled),
    useCommentMutations: () => ({
      addComment: mockAddComment,
      updateComment: mockUpdateComment,
      deleteComment: mockDeleteComment,
      togglePinComment: mockTogglePinComment,
      ...mockMutationFlags,
    }),
  };
});

function createAuthContext(role: UserRole, userId = 'user-1'): AuthContextValue {
  const isGuest = role === 'guest';
  return {
    user: isGuest
      ? null
      : ({ id: userId, email: `${role}@wingmacc.org` } as AuthContextValue['user']),
    profile: isGuest
      ? null
      : {
          id: userId,
          email: `${role}@wingmacc.org`,
          first_name: role === 'admin' ? 'Dan' : 'Joel',
          last_name: role === 'admin' ? 'Caleb' : 'Santos',
          role,
          created_at: '2026-11-18T00:00:00.000Z',
        },
    role,
    isLoading: false,
    theme: 'light',
    toggleTheme: vi.fn(),
    showGateway: false,
    dismissGateway: vi.fn(),
    openAuthModal: vi.fn(),
    closeAuthModal: vi.fn(),
    isAuthModalOpen: false,
    authModalMode: 'login',
    setAuthModalMode: vi.fn(),
    signOut: vi.fn(async () => {}),
    refreshProfile: vi.fn(async () => {}),
  };
}

function makeComment(overrides: Partial<ItemComment> = {}): ItemComment {
  return {
    id: 'c-1',
    item_id: 'item_1',
    user_id: 'user-1',
    author_name: 'Joel Santos',
    author_email: 'joel@wingmacc.org',
    tag: 'note',
    body: 'Batter head tuned cleanly before service.',
    pinned: false,
    created_at: '2026-11-20T09:00:00.000Z',
    updated_at: '2026-11-20T09:00:00.000Z',
    ...overrides,
  };
}

function renderSection(props: { itemId?: string; isOffline?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ItemCommentsSection itemId={props.itemId ?? 'item_1'} isOffline={props.isOffline} />
    </QueryClientProvider>
  );
}

describe('ItemCommentsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationFlags.isAdding = false;
    mockMutationFlags.isUpdating = false;
    mockMutationFlags.isDeleting = false;
    mockMutationFlags.isTogglingPin = false;
    mockMutationFlags.pendingCommentId = null;

    mockUseAuth.mockReturnValue(createAuthContext('member', 'user-1'));
    mockUseItemComments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });
    mockAddComment.mockResolvedValue(makeComment());
    mockUpdateComment.mockResolvedValue(makeComment());
    mockDeleteComment.mockResolvedValue(undefined);
    mockTogglePinComment.mockResolvedValue(makeComment({ pinned: true }));
  });

  it('renders null and disables comment query when role is guest', () => {
    mockUseAuth.mockReturnValue(createAuthContext('guest'));
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
    expect(mockUseItemComments).toHaveBeenCalledWith('item_1', false);
  });

  it('shows loading and error states cleanly with retry support', async () => {
    const user = userEvent.setup();
    mockUseItemComments.mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    const { rerender } = renderSection();
    expect(screen.getByText(/loading notes/i)).toBeInTheDocument();

    mockUseItemComments.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error('Unable to reach database'),
      refetch: mockRefetch,
    });

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ItemCommentsSection itemId="item_1" />
      </QueryClientProvider>
    );

    expect(screen.getByText(/unable to reach database/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('displays pinned badge, tag labels, live character counter, and submits note with selected tag and Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const comments: ItemComment[] = [
      makeComment({
        id: 'c-pin',
        pinned: true,
        tag: 'setup',
        author_name: 'Dan Caleb',
        user_id: 'admin-1',
        body: 'Use 48V phantom power only on channel 1.',
      }),
      makeComment({
        id: 'c-issue',
        pinned: false,
        tag: 'issue',
        author_name: 'Joel Santos',
        user_id: 'user-1',
        body: 'Snare throw-off sticks slightly.',
      }),
    ];

    mockUseItemComments.mockReturnValue({
      data: comments,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    renderSection();

    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getAllByText('Setup Tip').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Issue').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Use 48V phantom power only on channel 1.')).toBeInTheDocument();
    expect(screen.getByText('0 / 2000')).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: /add a note/i });
    expect(textarea).toHaveAttribute('maxLength', '2000');

    await user.click(screen.getByRole('button', { name: 'Repair' }));
    await user.type(textarea, 'Needs new XLR jack');
    expect(screen.getByText('18 / 2000')).toBeInTheDocument();

    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => {
      expect(mockAddComment).toHaveBeenCalledWith({
        body: 'Needs new XLR jack',
        tag: 'repair',
      });
    });

    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });

  it('disables composer and mutations with clear offline notice when isOffline is true', () => {
    mockUseItemComments.mockReturnValue({
      data: [makeComment({ id: 'c-own', user_id: 'user-1' })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    renderSection({ isOffline: true });

    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /add a note/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /post note/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /edit note/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /delete note/i })).toBeDisabled();
  });

  it('allows author inline edit (save/cancel) and delete confirmation via AlertDialog, hiding actions for other members', async () => {
    const user = userEvent.setup();
    const ownComment = makeComment({
      id: 'c-own',
      user_id: 'user-1',
      author_name: 'Joel Santos',
      tag: 'note',
      body: 'Original note text',
    });
    const otherComment = makeComment({
      id: 'c-other',
      user_id: 'user-2',
      author_name: 'Maria Reyes',
      tag: 'setup',
      body: 'Other member setup tip',
    });

    mockUseItemComments.mockReturnValue({
      data: [ownComment, otherComment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    renderSection();

    const ownCard = screen.getByText('Original note text').closest('article')!;
    const otherCard = screen.getByText('Other member setup tip').closest('article')!;

    expect(within(otherCard).queryByRole('button', { name: /edit note/i })).not.toBeInTheDocument();
    expect(within(otherCard).queryByRole('button', { name: /delete note/i })).not.toBeInTheDocument();
    expect(within(ownCard).queryByRole('button', { name: /pin note/i })).not.toBeInTheDocument();

    // Enter edit mode and cancel
    await user.click(within(ownCard).getByRole('button', { name: /edit note/i }));
    const editBox = within(ownCard).getByRole('textbox', { name: /edit note/i });
    await user.clear(editBox);
    await user.type(editBox, 'Temporary change');
    await user.click(within(ownCard).getByRole('button', { name: /cancel/i }));

    expect(mockUpdateComment).not.toHaveBeenCalled();
    expect(within(ownCard).getByText('Original note text')).toBeInTheDocument();

    // Enter edit mode, change tag & body, and save
    await user.click(within(ownCard).getByRole('button', { name: /edit note/i }));
    const editBox2 = within(ownCard).getByRole('textbox', { name: /edit note/i });
    await user.clear(editBox2);
    await user.type(editBox2, 'Updated repair detail');
    await user.click(within(ownCard).getByRole('button', { name: 'Issue' }));
    await user.click(within(ownCard).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockUpdateComment).toHaveBeenCalledWith({
        id: 'c-own',
        body: 'Updated repair detail',
        tag: 'issue',
      });
    });

    // Delete with AlertDialog confirmation
    await user.click(within(ownCard).getByRole('button', { name: /delete note/i }));
    const alertDialog = await screen.findByRole('alertdialog');
    await user.click(within(alertDialog).getByRole('button', { name: /cancel/i }));
    expect(mockDeleteComment).not.toHaveBeenCalled();

    await user.click(within(ownCard).getByRole('button', { name: /delete note/i }));
    const alertDialog2 = await screen.findByRole('alertdialog');
    await user.click(within(alertDialog2).getByRole('button', { name: /delete note/i }));

    await waitFor(() => {
      expect(mockDeleteComment).toHaveBeenCalledWith('c-own');
    });
  });

  it('allows Admins to Pin/Unpin and moderate Delete any note while keeping Edit author-only', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue(createAuthContext('admin', 'admin-1'));

    const memberComment = makeComment({
      id: 'c-member',
      user_id: 'user-2',
      author_name: 'Maria Reyes',
      pinned: false,
      body: 'Stand screw needs tightening.',
    });

    mockUseItemComments.mockReturnValue({
      data: [memberComment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    renderSection();

    const card = screen.getByText('Stand screw needs tightening.').closest('article')!;
    expect(within(card).queryByRole('button', { name: /edit note/i })).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: /pin note/i }));
    expect(mockTogglePinComment).toHaveBeenCalledWith({
      id: 'c-member',
      pinned: true,
    });

    await user.click(within(card).getByRole('button', { name: /delete note/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /delete note/i }));

    await waitFor(() => {
      expect(mockDeleteComment).toHaveBeenCalledWith('c-member');
    });
  });

  it('supports Cmd+Enter submit, Escape cancel edit, edited indicator, error retention, and resets state on itemId change', async () => {
    const user = userEvent.setup();
    const editedComment = makeComment({
      id: 'c-edited',
      user_id: 'user-1',
      body: 'Edited cable tip',
      created_at: '2026-11-20T09:00:00.000Z',
      updated_at: '2026-11-20T09:10:00.000Z',
    });

    mockUseItemComments.mockReturnValue({
      data: [editedComment],
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ItemCommentsSection itemId="item_1" />
      </QueryClientProvider>
    );

    expect(screen.getByText(/· edited/)).toBeInTheDocument();

    // Failed add keeps draft text and shows alert
    mockAddComment.mockRejectedValueOnce(new Error('Network offline'));
    const textarea = screen.getByRole('textbox', { name: /add a note/i });
    await user.type(textarea, 'Draft note to preserve');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network offline');
    });
    expect(textarea).toHaveValue('Draft note to preserve');

    // Escape exits inline edit cleanly
    const card = screen.getByText('Edited cable tip').closest('article')!;
    await user.click(within(card).getByRole('button', { name: /edit note/i }));
    const editBox = within(card).getByRole('textbox', { name: /edit note/i });
    await user.type(editBox, ' extra');
    await user.keyboard('{Escape}');
    expect(within(card).queryByRole('textbox', { name: /edit note/i })).not.toBeInTheDocument();

    // Switching itemId clears composer draft and errors
    rerender(
      <QueryClientProvider client={queryClient}>
        <ItemCommentsSection itemId="item_2" />
      </QueryClientProvider>
    );
    expect(screen.getByRole('textbox', { name: /add a note/i })).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
