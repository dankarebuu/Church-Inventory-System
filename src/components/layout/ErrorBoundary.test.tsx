import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowingChild({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders fallback recovery UI on unexpected render errors and resets on Try Again', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let shouldThrow = true;
    function ConditionalChild() {
      if (shouldThrow) {
        return <ThrowingChild message="Boom during render" />;
      }
      return <div>Recovered Content</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalChild />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('alert')).toHaveTextContent('Boom during render');

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('Recovered Content')).toBeInTheDocument();
  });

  it('shows a version-refresh prompt for stale dynamic-import chunk errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingChild message="Failed to fetch dynamically imported module: https://app.example/assets/InventoryPage-abc.js" />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('New App Version Available');
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });
});
