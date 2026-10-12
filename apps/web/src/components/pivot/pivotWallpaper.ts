import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";

/**
 * The Pivot view's wallpaper: one static image behind the panes, with a dim level.
 * Stored on this device only, downscaled to the screen once when picked, so the
 * view paints a single layer with no filter over it.
 */

export const PivotWallpaper = Schema.Struct({
  /** A JPEG data URL, already at screen size. */
  image: Schema.String,
  /** 0 shows the image as is; 0.9 nearly hides it. */
  dim: Schema.Number,
});
export type PivotWallpaper = typeof PivotWallpaper.Type;

const STORAGE_KEY = "t3pivot:pivot-wallpaper:v1";
const NullableWallpaper = Schema.NullOr(PivotWallpaper);

export const MAX_WALLPAPER_DIM = 0.9;
export const DEFAULT_WALLPAPER_DIM = 0.4;

export const usePivotWallpaper = () =>
  useLocalStorage<PivotWallpaper | null, unknown>(STORAGE_KEY, null, NullableWallpaper);

export const clampWallpaperDim = (dim: number) =>
  Number.isFinite(dim) ? Math.min(MAX_WALLPAPER_DIM, Math.max(0, dim)) : DEFAULT_WALLPAPER_DIM;

/** The size an image is scaled to cover the screen without upscaling. */
export function wallpaperSize(
  image: { readonly width: number; readonly height: number },
  screen: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } {
  const scale = Math.min(1, Math.max(screen.width / image.width, screen.height / image.height));
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

/** Reads an image file and downscales it to cover this screen, as a JPEG data URL. */
export async function downscaleWallpaper(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const size = wallpaperSize(bitmap, {
      width: window.screen.width * ratio,
      height: window.screen.height * ratio,
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Could not draw the wallpaper.");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
