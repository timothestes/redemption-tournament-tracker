// Shared crop-rect type (fractions of the source image, 0–1) + the pure CSS
// math the crop modal uses to live-preview a subrect: scale the background so
// the rect fills the container, then pan with percentage positioning (whose
// denominator is the leftover space, hence the 1-span divisor).
export type CropRect = { x: number; y: number; width: number; height: number };

export function cropBackgroundStyle(rect: CropRect): { backgroundSize: string; backgroundPosition: string } {
  const pos = (offset: number, span: number) => (span >= 1 ? 0 : (offset / (1 - span)) * 100);
  return {
    backgroundSize: `${100 / rect.width}% ${100 / rect.height}%`,
    backgroundPosition: `${pos(rect.x, rect.width)}% ${pos(rect.y, rect.height)}%`,
  };
}
