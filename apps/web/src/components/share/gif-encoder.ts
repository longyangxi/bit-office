/**
 * gif-encoder.ts — Minimal GIF89a encoder from ImageData frames.
 *
 * Zero external dependencies. Encodes directly to a Uint8Array / Blob.
 * Uses median-cut color quantization (256 colors) + LZW compression.
 *
 * Good enough for 800×420 @ 60-80 frames → ~300-600KB output.
 */

import type { RenderedFrame } from "./recap-renderer";

/**
 * Encode an array of rendered frames into a GIF89a Blob.
 * Runs synchronously (consider wrapping in a Web Worker for large frame counts).
 */
export function encodeGif(frames: RenderedFrame[], width: number, height: number): Blob {
  const buf = new GifWriter(width, height);

  for (const frame of frames) {
    const { palette, indexed } = quantize(frame.imageData.data, width * height);
    const delay = Math.round(frame.delayMs / 10); // GIF uses centiseconds
    buf.addFrame(indexed, palette, delay, width, height);
  }

  return buf.toBlob();
}

// ---- Color Quantization (median-cut, 256 colors) ----

interface QuantResult {
  palette: number[];  // flat R,G,B array (256 × 3 = 768 entries)
  indexed: Uint8Array; // palette index per pixel
}

function quantize(rgba: Uint8ClampedArray, pixelCount: number): QuantResult {
  // Build color histogram (subsample for speed)
  const step = Math.max(1, Math.floor(pixelCount / 10000));
  const colors: [number, number, number][] = [];
  for (let i = 0; i < pixelCount; i += step) {
    const off = i * 4;
    colors.push([rgba[off], rgba[off + 1], rgba[off + 2]]);
  }

  // Median-cut into 256 buckets
  const buckets = medianCut(colors, 8); // 2^8 = 256

  // Build palette
  const palette: number[] = [];

  for (const bucket of buckets) {
    let r = 0, g = 0, b = 0;
    for (const [cr, cg, cb] of bucket) {
      r += cr; g += cg; b += cb;
    }
    const len = bucket.length || 1;
    const ar = Math.round(r / len);
    const ag = Math.round(g / len);
    const ab = Math.round(b / len);
    palette.push(ar, ag, ab);
  }

  // Pad to 256 colors
  while (palette.length < 768) {
    palette.push(0, 0, 0);
  }

  // Build fast lookup (quantized to 5-bit per channel)
  const lookup = new Map<number, number>();
  for (let i = 0; i < 256 && i * 3 + 2 < palette.length; i++) {
    const key = ((palette[i * 3] >> 3) << 10) | ((palette[i * 3 + 1] >> 3) << 5) | (palette[i * 3 + 2] >> 3);
    if (!lookup.has(key)) lookup.set(key, i);
  }

  // Map pixels to palette indices
  const indexed = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    const r = rgba[off], g = rgba[off + 1], b = rgba[off + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = lookup.get(key);
    if (idx === undefined) {
      idx = findClosest(palette, r, g, b);
      lookup.set(key, idx);
    }
    indexed[i] = idx;
  }

  return { palette, indexed };
}

function medianCut(colors: [number, number, number][], depth: number): [number, number, number][][] {
  if (depth === 0 || colors.length <= 1) return [colors];

  // Find channel with largest range
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const [r, g, b] of colors) {
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (g < minG) minG = g; if (g > maxG) maxG = g;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }

  const rangeR = maxR - minR;
  const rangeG = maxG - minG;
  const rangeB = maxB - minB;

  let channel: 0 | 1 | 2 = 0;
  if (rangeG >= rangeR && rangeG >= rangeB) channel = 1;
  else if (rangeB >= rangeR && rangeB >= rangeG) channel = 2;

  colors.sort((a, b) => a[channel] - b[channel]);
  const mid = Math.floor(colors.length / 2);

  return [
    ...medianCut(colors.slice(0, mid), depth - 1),
    ...medianCut(colors.slice(mid), depth - 1),
  ];
}

function findClosest(palette: number[], r: number, g: number, b: number): number {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < 256; i++) {
    const dr = palette[i * 3] - r;
    const dg = palette[i * 3 + 1] - g;
    const db = palette[i * 3 + 2] - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

// ---- GIF89a Binary Writer ----

class GifWriter {
  private chunks: Uint8Array[] = [];

  constructor(private width: number, private height: number) {
    // Header
    this.writeBytes(strBytes("GIF89a"));
    // Logical Screen Descriptor (no global color table)
    this.writeU16(width);
    this.writeU16(height);
    this.writeByte(0x00); // no GCT
    this.writeByte(0);    // bg color index
    this.writeByte(0);    // pixel aspect ratio

    // Netscape looping extension (infinite loop)
    this.writeByte(0x21); // extension
    this.writeByte(0xFF); // app extension
    this.writeByte(11);   // block size
    this.writeBytes(strBytes("NETSCAPE2.0"));
    this.writeByte(3);    // sub-block size
    this.writeByte(1);    // loop sub-block id
    this.writeU16(0);     // loop count (0 = infinite)
    this.writeByte(0);    // terminator
  }

  addFrame(indexed: Uint8Array, palette: number[], delayCentiseconds: number, w: number, h: number) {
    // Graphic Control Extension
    this.writeByte(0x21); // extension
    this.writeByte(0xF9); // GCE
    this.writeByte(4);    // block size
    this.writeByte(0x00); // no transparency, no disposal
    this.writeU16(delayCentiseconds);
    this.writeByte(0);    // transparent color index
    this.writeByte(0);    // terminator

    // Image Descriptor
    this.writeByte(0x2C); // image separator
    this.writeU16(0);     // left
    this.writeU16(0);     // top
    this.writeU16(w);
    this.writeU16(h);
    this.writeByte(0x87); // local color table, 256 colors (2^(7+1))

    // Local Color Table (256 × 3 bytes)
    const lct = new Uint8Array(768);
    for (let i = 0; i < 768; i++) lct[i] = palette[i] ?? 0;
    this.writeBytes(lct);

    // LZW compressed image data
    const minCodeSize = 8;
    this.writeByte(minCodeSize);
    const compressed = lzwEncode(indexed, minCodeSize);
    // Write in sub-blocks (max 255 bytes each)
    let offset = 0;
    while (offset < compressed.length) {
      const blockSize = Math.min(255, compressed.length - offset);
      this.writeByte(blockSize);
      this.writeBytes(compressed.subarray(offset, offset + blockSize));
      offset += blockSize;
    }
    this.writeByte(0); // block terminator
  }

  toBlob(): Blob {
    // Trailer
    this.writeByte(0x3B);
    return new Blob(this.chunks as BlobPart[], { type: "image/gif" });
  }

  private writeByte(b: number) {
    this.chunks.push(new Uint8Array([b & 0xFF]));
  }

  private writeU16(v: number) {
    this.chunks.push(new Uint8Array([v & 0xFF, (v >> 8) & 0xFF]));
  }

  private writeBytes(data: Uint8Array) {
    this.chunks.push(data);
  }
}

// ---- LZW Encoder ----

function lzwEncode(indexed: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  const output: number[] = [];
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const maxCode = 4096; // 12-bit max

  // Code table: key = prefix + "," + byte → code
  let table = new Map<string, number>();
  const initTable = () => {
    table = new Map();
    for (let i = 0; i < clearCode; i++) {
      table.set(String(i), i);
    }
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  // Bit packer
  let bitBuf = 0;
  let bitCount = 0;
  const emitCode = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuf & 0xFF);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  };

  initTable();
  emitCode(clearCode);

  if (indexed.length === 0) {
    emitCode(eoiCode);
    if (bitCount > 0) output.push(bitBuf & 0xFF);
    return new Uint8Array(output);
  }

  let prefix = String(indexed[0]);
  for (let i = 1; i < indexed.length; i++) {
    const byte = indexed[i];
    const key = prefix + "," + byte;

    if (table.has(key)) {
      prefix = key;
    } else {
      emitCode(table.get(prefix)!);
      if (nextCode < maxCode) {
        table.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        emitCode(clearCode);
        initTable();
      }
      prefix = String(byte);
    }
  }

  emitCode(table.get(prefix)!);
  emitCode(eoiCode);

  if (bitCount > 0) output.push(bitBuf & 0xFF);

  return new Uint8Array(output);
}

function strBytes(s: string): Uint8Array {
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
  return arr;
}
