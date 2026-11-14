// Content-based inspection of uploaded images (issue #116).
//
// The client-declared MIME type and file name are never trusted. The format is decided
// from the file's own bytes, only raster formats that browsers and the Android WebView
// render without scripting are allowed (no SVG, no GIF/HEIC/BMP/TIFF), and the declared
// dimensions are read from the header without decoding the pixels.

export type InspectedImage = {
  mime: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
};

export const MAX_IMAGE_SIDE = 8192;
export const MAX_IMAGE_PIXELS = 36_000_000;

type Dimensions = { width: number; height: number };

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function hasBytes(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  if (offset + expected.length > bytes.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function pngDimensions(bytes: Uint8Array): Dimensions | null {
  // Signature (8 bytes), then the IHDR chunk must come first: length, "IHDR", width, height.
  if (!hasBytes(bytes, 12, ascii("IHDR")) || bytes.length < 24) return null;
  if (readUint32BE(bytes, 8) !== 13) return null;
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

function jpegDimensions(bytes: Uint8Array): Dimensions | null {
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;

    // Skip fill bytes before the marker code.
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 2 > bytes.length) return null;

    const length = readUint16BE(bytes, offset);
    if (length < 2) return null;

    // SOF0..SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 7 > bytes.length) return null;
      return { height: readUint16BE(bytes, offset + 3), width: readUint16BE(bytes, offset + 5) };
    }

    // Start of scan without a frame header: not a valid image.
    if (marker === 0xda) return null;
    offset += length;
  }

  return null;
}

function webpDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (chunk === "VP8 ") {
    if (!hasBytes(bytes, 23, [0x9d, 0x01, 0x2a])) return null;
    return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
  }

  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }

  if (chunk === "VP8X") {
    return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
  }

  return null;
}

/**
 * Returns the detected image or null when the bytes are not a supported, well-formed
 * image header. Callers must also check the returned dimensions with `dimensionsAllowed`.
 */
export function inspectImage(bytes: Uint8Array): InspectedImage | null {
  let mime: InspectedImage["mime"];
  let extension: InspectedImage["extension"];
  let dimensions: Dimensions | null;

  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    mime = "image/png";
    extension = "png";
    dimensions = pngDimensions(bytes);
  } else if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) {
    mime = "image/jpeg";
    extension = "jpg";
    dimensions = jpegDimensions(bytes);
  } else if (hasBytes(bytes, 0, ascii("RIFF")) && hasBytes(bytes, 8, ascii("WEBP"))) {
    mime = "image/webp";
    extension = "webp";
    dimensions = webpDimensions(bytes);
  } else {
    return null;
  }

  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return null;
  return { mime, extension, width: dimensions.width, height: dimensions.height };
}

export function dimensionsAllowed(image: Pick<InspectedImage, "width" | "height">): boolean {
  return image.width <= MAX_IMAGE_SIDE
    && image.height <= MAX_IMAGE_SIDE
    && image.width * image.height <= MAX_IMAGE_PIXELS;
}
