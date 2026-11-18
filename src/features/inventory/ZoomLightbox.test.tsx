import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoomLightbox } from './ZoomLightbox';

describe('ZoomLightbox', () => {
  it('does not close when a zoomed drag-pan finishes on the stage or backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ZoomLightbox
        open={true}
        images={['https://cdn.example.com/snare.jpg']}
        title="Pearl Brass Snare"
        onClose={onClose}
      />
    );

    // Zoom in so panning is active
    await user.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(screen.getByText('250%')).toBeInTheDocument();

    const img = screen.getByAltText('Pearl Brass Snare 1');
    const stage = screen.getByTestId('lightbox-stage');

    // Start pan on <img>, drag > 4px, release mouseup, and fire click on stage
    fireEvent.mouseDown(img, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 145, clientY: 130 });
    fireEvent.mouseUp(window, { clientX: 145, clientY: 130 });
    fireEvent.click(stage);

    expect(onClose).not.toHaveBeenCalled();

    // Subsequent clean click on stage without dragging closes the lightbox
    fireEvent.click(stage);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on clean backdrop click when no drag occurred', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ZoomLightbox
        open={true}
        images={['https://cdn.example.com/snare.jpg']}
        title="Pearl Brass Snare"
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /pearl brass snare lightbox preview/i });
    await user.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
