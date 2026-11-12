import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { previewJpeg } from './preview.js';

describe('in-memory live preview conversion', () => {
  it.each([0, 1, 2, 3])('encodes packed pixel format %i as an opaque JPEG', format => {
    const channels = format < 2 ? 3 : 4;
    const bgr = format === 1 || format === 3;
    const pixel = bgr ? [0, 0, 255] : [255, 0, 0];
    if (channels === 4) pixel.push(0);
    const bytes = previewJpeg(Buffer.from(pixel), 1, 1, channels, format);
    expect(bytes).not.toBeNull();
    const decoded = jpeg.decode(bytes!, { useTArray: true });
    expect(decoded).toMatchObject({ width: 1, height: 1 });
    expect(decoded.data[0]).toBeGreaterThan(240);
    expect(decoded.data[1]).toBeLessThan(15);
    expect(decoded.data[2]).toBeLessThan(15);
    expect(decoded.data[3]).toBe(255);
  });

  it('handles row padding and scales a frame to 320 pixels wide', () => {
    const width = 640, height = 240, stride = width * 3 + 8;
    const pixels = Buffer.alloc(stride * height, 100);
    const bytes = previewJpeg(pixels, width, height, stride, 0);
    const decoded = jpeg.decode(bytes!, { useTArray: true });
    expect(decoded).toMatchObject({ width: 320, height: 120 });
  });

  it.each([
    [1, 1, 4, 4], [1, 1, 4, -1], [0, 1, 4, 2], [1, -1, 4, 2],
    [4097, 1, 16388, 2], [1, 4097, 4, 2], [1.5, 1, 8, 2],
    [1, 1, 3, 2], [1, 1, 4.5, 2], [NaN, 1, 4, 2], [1, Infinity, 4, 2],
  ])('drops unsupported or invalid frame shape %j', (width, height, stride, format) => {
    expect(previewJpeg(Buffer.alloc(4), width, height, stride, format)).toBeNull();
  });

  it('rejects truncated buffers before encoding', () => {
    expect(previewJpeg(Buffer.alloc(7), 1, 2, 4, 2)).toBeNull();
  });
});
