export const IMAGE_COMPRESS_THRESHOLD_BYTES = 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 1600;
export const IMAGE_JPEG_QUALITY = 0.82;

const SKIP_COMPRESS_MIME_TYPES = new Set(['image/gif', 'image/svg+xml']);

function replaceFileExtension(fileName: string, nextExt: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex > 0) {
    return `${trimmed.slice(0, dotIndex)}.${nextExt}`;
  }
  return trimmed ? `${trimmed}.${nextExt}` : `photo.${nextExt}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode image'));
    img.src = src;
  });
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * Downscales and JPEG-compresses oversized raster images (> 1 MB) in the
 * browser before upload, falling back to the original file whenever compression
 * is unnecessary, unsupported, or yields a larger payload.
 */
export async function compressImageFile(file: File): Promise<File> {
  if (
    !file.type ||
    !file.type.toLowerCase().startsWith('image/') ||
    SKIP_COMPRESS_MIME_TYPES.has(file.type.toLowerCase()) ||
    file.size <= IMAGE_COMPRESS_THRESHOLD_BYTES
  ) {
    return file;
  }

  if (
    typeof document === 'undefined' ||
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width <= 0 || height <= 0) {
      return file;
    }

    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return file;
    }

    // Fill white background so transparent PNGs convert cleanly to JPEG.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await canvasToJpegBlob(canvas, IMAGE_JPEG_QUALITY);
    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], replaceFileExtension(file.name, 'jpg'), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

/**
 * Compresses any oversized raster files in a selected batch while preserving
 * exact File references for small images (<= 1 MB) or non-raster formats.
 */
export async function compressImageFiles(files: readonly File[]): Promise<File[]> {
  if (
    files.every(
      (file) =>
        !file.type.toLowerCase().startsWith('image/') ||
        SKIP_COMPRESS_MIME_TYPES.has(file.type.toLowerCase()) ||
        file.size <= IMAGE_COMPRESS_THRESHOLD_BYTES
    )
  ) {
    return [...files];
  }

  return Promise.all(files.map(compressImageFile));
}
