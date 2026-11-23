import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ZoomLightboxProps {
  open: boolean;
  images: readonly string[];
  initialIndex?: number;
  title?: string;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_CLICK_SCALE = 2.5;
const DRAG_THRESHOLD_PX = 4;

function clampScale(next: number): number {
  return Math.max(MIN_SCALE, Math.min(next, MAX_SCALE));
}

function computeTouchDistance(touches: React.TouchList): number {
  if (touches.length < 2) return 0;
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

/**
 * Fullscreen image lightbox supporting click/double-click zoom toggle, drag pan,
 * wheel zoom, mobile pinch-to-zoom, multi-photo stepping, and Escape close.
 */
export function ZoomLightbox({
  open,
  images,
  initialIndex = 0,
  title = 'Equipment photo',
  onClose,
}: ZoomLightboxProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [smoothTransition, setSmoothTransition] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const panOriginRef = useRef({ x: 0, y: 0 });
  const panStartPointerRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const pinchStartDistanceRef = useRef(0);
  const pinchBaseScaleRef = useRef(MIN_SCALE);
  const panningRef = useRef(false);
  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const suppressResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSuppressTimer = useCallback(() => {
    if (suppressResetTimerRef.current !== null) {
      clearTimeout(suppressResetTimerRef.current);
      suppressResetTimerRef.current = null;
    }
  }, []);

  const resetZoom = useCallback(
    (smooth = true) => {
      clearSuppressTimer();
      setSmoothTransition(smooth);
      setScale(MIN_SCALE);
      setOffset({ x: 0, y: 0 });
      setIsPanning(false);
      panningRef.current = false;
      didDragRef.current = false;
      suppressNextClickRef.current = false;
      pinchStartDistanceRef.current = 0;
      pinchBaseScaleRef.current = MIN_SCALE;
    },
    [clearSuppressTimer]
  );

  useEffect(() => {
    if (!open) return;
    const bounded = Math.max(0, Math.min(initialIndex, Math.max(images.length - 1, 0)));
    setActiveIndex(bounded);
    resetZoom(false);
  }, [open, initialIndex, images.length, resetZoom]);

  const stepImage = useCallback(
    (delta: number) => {
      if (images.length <= 1) return;
      setActiveIndex((prev) => (prev + delta + images.length) % images.length);
      resetZoom(false);
    },
    [images.length, resetZoom]
  );

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepImage(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepImage(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [open, onClose, stepImage]);

  useEffect(() => {
    if (!open) return;

    const handleWindowMouseMove = (event: MouseEvent) => {
      if (!panningRef.current) return;
      if (!didDragRef.current) {
        const distance = Math.hypot(
          event.clientX - panStartPointerRef.current.x,
          event.clientY - panStartPointerRef.current.y
        );
        if (distance > DRAG_THRESHOLD_PX) {
          didDragRef.current = true;
        }
      }
      setSmoothTransition(false);
      setOffset({
        x: event.clientX - panOriginRef.current.x,
        y: event.clientY - panOriginRef.current.y,
      });
    };

    const handleWindowMouseUp = () => {
      if (!panningRef.current) return;
      const wasDrag = didDragRef.current;
      panningRef.current = false;
      didDragRef.current = false;
      setIsPanning(false);

      if (wasDrag) {
        suppressNextClickRef.current = true;
        clearSuppressTimer();
        suppressResetTimerRef.current = setTimeout(() => {
          suppressNextClickRef.current = false;
          suppressResetTimerRef.current = null;
        }, 0);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      clearSuppressTimer();
    };
  }, [open, clearSuppressTimer]);

  if (!open || images.length === 0) return null;

  const currentSrc = images[activeIndex] ?? images[0];
  const isZoomed = scale > MIN_SCALE;

  const handleToggleZoom = () => {
    if (isZoomed) {
      resetZoom(true);
    } else {
      setSmoothTransition(true);
      setScale(DOUBLE_CLICK_SCALE);
      setOffset({ x: 0, y: 0 });
    }
  };

  const handleStepZoom = (delta: number) => {
    setSmoothTransition(true);
    setScale((prev) => {
      const next = clampScale(Number((prev + delta).toFixed(2)));
      if (next <= MIN_SCALE) {
        setOffset({ x: 0, y: 0 });
      }
      return next;
    });
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLImageElement>) => {
    if (event.button !== 0 || scaleRef.current <= MIN_SCALE) return;
    event.preventDefault();
    clearSuppressTimer();
    didDragRef.current = false;
    suppressNextClickRef.current = false;
    panStartPointerRef.current = { x: event.clientX, y: event.clientY };
    panOriginRef.current = {
      x: event.clientX - offsetRef.current.x,
      y: event.clientY - offsetRef.current.y,
    };
    panningRef.current = true;
    setIsPanning(true);
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLImageElement>) => {
    if (event.touches.length === 2) {
      pinchStartDistanceRef.current = computeTouchDistance(event.touches);
      pinchBaseScaleRef.current = scaleRef.current;
      panningRef.current = false;
      setIsPanning(false);
      return;
    }

    if (event.touches.length === 1 && scaleRef.current > MIN_SCALE) {
      panOriginRef.current = {
        x: event.touches[0].clientX - offsetRef.current.x,
        y: event.touches[0].clientY - offsetRef.current.y,
      };
      panningRef.current = true;
      setIsPanning(true);
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLImageElement>) => {
    if (event.touches.length === 2 && pinchStartDistanceRef.current > 0) {
      event.preventDefault();
      const distance = computeTouchDistance(event.touches);
      const nextScale = clampScale(
        (pinchBaseScaleRef.current * distance) / pinchStartDistanceRef.current
      );
      setSmoothTransition(false);
      setScale(nextScale);
      if (nextScale <= MIN_SCALE) {
        setOffset({ x: 0, y: 0 });
      }
      return;
    }

    if (event.touches.length === 1 && panningRef.current && scaleRef.current > MIN_SCALE) {
      event.preventDefault();
      setSmoothTransition(false);
      setOffset({
        x: event.touches[0].clientX - panOriginRef.current.x,
        y: event.touches[0].clientY - panOriginRef.current.y,
      });
    }
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLImageElement>) => {
    if (event.touches.length < 2) {
      pinchStartDistanceRef.current = 0;
      pinchBaseScaleRef.current = scaleRef.current;
    }

    if (event.touches.length === 1 && scaleRef.current > MIN_SCALE) {
      panOriginRef.current = {
        x: event.touches[0].clientX - offsetRef.current.x,
        y: event.touches[0].clientY - offsetRef.current.y,
      };
      panningRef.current = true;
      setIsPanning(true);
    } else if (event.touches.length === 0) {
      panningRef.current = false;
      setIsPanning(false);
      if (scaleRef.current < MIN_SCALE) {
        resetZoom(true);
      }
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const delta = event.deltaY < 0 ? 0.35 : -0.35;
    handleStepZoom(delta);
  };

  const handleBackdropOrStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      clearSuppressTimer();
      return;
    }
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} lightbox preview`}
      className="fixed inset-0 z-[70] flex flex-col bg-black/92 text-white backdrop-blur-sm"
      onClick={handleBackdropOrStageClick}
      onWheel={handleWheel}
    >
      {/* Top Toolbar */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="truncate font-display text-sm font-semibold text-white/90">
            {title}
          </span>
          {images.length > 1 && (
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-sans text-[11px] tabular-nums text-white/80">
              {activeIndex + 1} / {images.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => handleStepZoom(-0.5)}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            className="text-white hover:bg-white/15 hover:text-white"
          >
            <ZoomOut className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggleZoom}
            aria-label={isZoomed ? 'Reset zoom' : 'Zoom in'}
            className="font-sans text-xs tabular-nums text-white hover:bg-white/15 hover:text-white"
          >
            <ZoomIn className="size-4" aria-hidden="true" />
            <span>{Math.round(scale * 100)}%</span>
          </Button>
          {isZoomed && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => resetZoom(true)}
              aria-label="Reset pan and zoom"
              className="text-white hover:bg-white/15 hover:text-white"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close lightbox"
            className="text-white hover:bg-white/15 hover:text-white"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Image Canvas */}
      <div
        data-testid="lightbox-stage"
        className="relative flex flex-1 items-center justify-center overflow-hidden p-4 select-none"
        onClick={handleBackdropOrStageClick}
      >
        {images.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              stepImage(-1);
            }}
            aria-label="Previous photo"
            className="absolute left-3 z-10 size-10 rounded-full bg-black/50 text-white hover:bg-black/75 hover:text-white"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
        )}

        <img
          src={currentSrc}
          alt={`${title} ${activeIndex + 1}`}
          draggable={false}
          onDoubleClick={(event) => {
            event.stopPropagation();
            handleToggleZoom();
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: smoothTransition ? 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
          }}
          className={cn(
            'max-h-[82vh] max-w-[90vw] rounded-lg object-contain touch-none',
            isZoomed ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          )}
        />

        {images.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              stepImage(1);
            }}
            aria-label="Next photo"
            className="absolute right-3 z-10 size-10 rounded-full bg-black/50 text-white hover:bg-black/75 hover:text-white"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="px-4 pb-4 text-center font-sans text-xs text-white/65">
        Double-click or pinch to zoom · Drag to pan · Press Esc to close
      </div>
    </div>
  );
}
