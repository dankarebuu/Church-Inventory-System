import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const { mockNeedRefresh, mockSetNeedRefresh, mockUpdateServiceWorker } = vi.hoisted(() => ({
  mockNeedRefresh: { value: false },
  mockSetNeedRefresh: vi.fn(),
  mockUpdateServiceWorker: vi.fn(async () => {}),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [mockNeedRefresh.value, mockSetNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: mockUpdateServiceWorker,
  }),
}));

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNeedRefresh.value = false;
  });

  it('renders nothing when no service worker update is waiting', () => {
    const { container } = render(<PwaUpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders Update Ready banner and invokes updateServiceWorker(true) on Reload', async () => {
    const user = userEvent.setup();
    mockNeedRefresh.value = true;

    render(<PwaUpdatePrompt />);

    const prompt = screen.getByRole('status');
    expect(prompt).toHaveTextContent(/Update Ready/i);

    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(mockUpdateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('dismisses the update banner when Later/Dismiss is clicked', async () => {
    const user = userEvent.setup();
    mockNeedRefresh.value = true;

    render(<PwaUpdatePrompt />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(mockSetNeedRefresh).toHaveBeenCalledWith(false);
  });
});
