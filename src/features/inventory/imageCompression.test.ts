import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compressImageFile,
  compressImageFiles,
  IMAGE_COMPRESS_THRESHOLD_BYTES,
} from './imageCompression';

describe('imageCompression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns small images, GIFs, SVGs, and non-images untouched', async () => {
    const smallJpeg = new File([new Uint8Array(512)], 'small.jpg', { type: 'image/jpeg' });
    const bigGif = new File([new Uint8Array(IMAGE_COMPRESS_THRESHOLD_BYTES + 100)], 'anim.gif', {
      type: 'image/gif',
    });
    const bigSvg = new File([new Uint8Array(IMAGE_COMPRESS_THRESHOLD_BYTES + 100)], 'logo.svg', {
      type: 'image/svg+xml',
    });
    const pdf = new File([new Uint8Array(IMAGE_COMPRESS_THRESHOLD_BYTES + 100)], 'manual.pdf', {
      type: 'application/pdf',
    });

    expect(await compressImageFile(smallJpeg)).toBe(smallJpeg);
    expect(await compressImageFile(bigGif)).toBe(bigGif);
    expect(await compressImageFile(bigSvg)).toBe(bigSvg);
    expect(await compressImageFile(pdf)).toBe(pdf);

    const batch = await compressImageFiles([smallJpeg, bigGif]);
    expect(batch).toEqual([smallJpeg, bigGif]);
    expect(batch[0]).toBe(smallJpeg);
  });

  it('downscales oversized raster images via canvas and revokes object URLs', async () => {
    const bigBytes = new Uint8Array(IMAGE_COMPRESS_THRESHOLD_BYTES + 50_000);
    const largePhoto = new File([bigBytes], 'camera-shot.png', { type: 'image/png' });

    const createUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-large-photo');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const OriginalImage = globalThis.Image;
    class MockImage {
      naturalWidth = 3200;
      naturalHeight = 2400;
      width = 3200;
      height = 2400;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => {
          this.onload?.();
        });
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    const mockCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
          toBlob: (cb: (blob: Blob | null) => void) => {
            cb(new Blob([new Uint8Array(25_000)], { type: 'image/jpeg' }));
          },
        } as unknown as HTMLCanvasElement;
      }
      return origCreateElement(tagName);
    });

    try {
      const compressed = await compressImageFile(largePhoto);
      expect(createUrlSpy).toHaveBeenCalledWith(largePhoto);
      expect(revokeUrlSpy).toHaveBeenCalledWith('blob:mock-large-photo');
      expect(mockCtx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
      expect(compressed.name).toBe('camera-shot.jpg');
      expect(compressed.type).toBe('image/jpeg');
      expect(compressed.size).toBe(25_000);
    } finally {
      globalThis.Image = OriginalImage;
    }
  });
});
