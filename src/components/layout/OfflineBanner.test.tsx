import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  it('renders nothing when online (isOffline is false)', () => {
    const { container } = render(<OfflineBanner isOffline={false} lastSyncedAt="2026-11-20T10:00:00.000Z" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders amber view-only notice with formatted last synced timestamp when offline', () => {
    render(<OfflineBanner isOffline={true} lastSyncedAt="2026-11-20T10:15:00.000Z" />);

    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/Offline — View-Only Mode \(last synced .+\)\./);
    expect(banner).toHaveTextContent(
      /Edits, check-offs, loans, and comments will re-enable when back online\./
    );
  });

  it('gracefully handles missing or invalid lastSyncedAt timestamp when offline', () => {
    const { rerender } = render(<OfflineBanner isOffline={true} lastSyncedAt={null} />);

    let banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      'Offline — View-Only Mode. Edits, check-offs, loans, and comments will re-enable when back online.'
    );
    expect(banner.textContent).not.toMatch(/last synced/i);
    expect(banner.textContent).not.toMatch(/invalid date/i);

    rerender(<OfflineBanner isOffline={true} lastSyncedAt="not-a-date" />);
    banner = screen.getByRole('status');
    expect(banner.textContent).not.toMatch(/last synced/i);
    expect(banner.textContent).not.toMatch(/invalid date/i);
  });
});
