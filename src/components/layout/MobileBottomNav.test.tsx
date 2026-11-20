import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MobileBottomNav } from './MobileBottomNav';

describe('MobileBottomNav', () => {
  it('renders Guest tabs (Dashboard, Inventory, Checklist, Categories) without Loans or More', () => {
    render(
      <MemoryRouter initialEntries={['/inventory']}>
        <MobileBottomNav role="guest" onOpenMore={vi.fn()} />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: /mobile bottom navigation/i });
    expect(nav).toHaveClass('md:hidden', 'no-print');
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');

    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    const inventoryLink = within(nav).getByRole('link', { name: 'Inventory' });
    expect(inventoryLink).toHaveAttribute('href', '/inventory');
    expect(inventoryLink).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Checklist' })).toHaveAttribute('href', '/checklist');
    expect(within(nav).getByRole('link', { name: 'Categories' })).toHaveAttribute('href', '/categories');

    expect(within(nav).queryByRole('link', { name: 'Loans' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('renders Member & Admin tabs (Dashboard, Inventory, Checklist, Loans, More) and triggers onOpenMore', async () => {
    const user = userEvent.setup();
    const onOpenMore = vi.fn();

    const { unmount } = render(
      <MemoryRouter initialEntries={['/loans']}>
        <MobileBottomNav role="member" onOpenMore={onOpenMore} />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: /mobile bottom navigation/i });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(within(nav).getByRole('link', { name: 'Inventory' })).toHaveAttribute('href', '/inventory');
    expect(within(nav).getByRole('link', { name: 'Checklist' })).toHaveAttribute('href', '/checklist');
    const loansLink = within(nav).getByRole('link', { name: 'Loans' });
    expect(loansLink).toHaveAttribute('href', '/loans');
    expect(loansLink).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument();

    const moreButton = within(nav).getByRole('button', { name: 'More' });
    await user.click(moreButton);
    expect(onOpenMore).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <MemoryRouter initialEntries={['/team']}>
        <MobileBottomNav role="admin" onOpenMore={onOpenMore} isMoreOpen={true} />
      </MemoryRouter>
    );
    const adminMore = screen.getByRole('button', { name: 'More' });
    expect(adminMore).toHaveAttribute('aria-expanded', 'true');
  });
});
