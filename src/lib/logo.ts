/** Largest file accepted, before it's shrunk. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Longest edge a stored logo keeps — plenty for the top bar and receipt tape. */
const MAX_EDGE = 256;

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/**
 * Turns an uploaded image into a data URL small enough to keep with the
 * settings. Photos are scaled down and stored as PNG; SVGs stay as they are.
 * Rejects with a message ready to show beside the field.
 */
export async function readLogo(file: File): Promise<string> {
  if (!LOGO_TYPES.includes(file.type)) throw new Error('Use a PNG, JPG, WebP, or SVG image.');
  if (file.size > MAX_BYTES) throw new Error('Keep the logo under 2 MB.');

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('That file couldn’t be read.'));
    reader.readAsDataURL(file);
  });
  if (file.type === 'image/svg+xml') return dataUrl;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('That image couldn’t be opened.'));
    el.src = dataUrl;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
