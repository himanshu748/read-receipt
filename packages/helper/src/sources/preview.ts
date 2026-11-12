import jpeg from 'jpeg-js';

/** Packed RGB/BGR/RGBA/BGRA → small in-memory JPEG; unsupported formats are dropped. */
export function previewJpeg(bytes: Uint8Array, width: number, height: number, stride: number, format: number): Uint8Array | null {
  const channels = format === 0 || format === 1 ? 3 : format === 2 || format === 3 ? 4 : 0;
  if (!channels || ![width, height, stride].every(Number.isInteger) || width < 1 || height < 1 ||
    width > 4096 || height > 4096 || stride < width * channels || bytes.length < stride * height) return null;
  const w = Math.min(320, width), h = Math.max(1, Math.round(height * w / width));
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const src = Math.floor(y * height / h) * stride + Math.floor(x * width / w) * channels;
    const dst = (y * w + x) * 4;
    const bgr = format === 1 || format === 3;
    rgba[dst] = bytes[src + (bgr ? 2 : 0)]!;
    rgba[dst + 1] = bytes[src + 1]!;
    rgba[dst + 2] = bytes[src + (bgr ? 0 : 2)]!;
    rgba[dst + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width: w, height: h }, 60).data;
}
