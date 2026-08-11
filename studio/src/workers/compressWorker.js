// studio/src/workers/compressWorker.js
// Resizing and re-encoding a photo, off the main thread — and while the pixels
// are already here, measuring two things that are worth knowing.
//
// Only what has an honest number behind it. Blur and exposure are measurable;
// whether a photograph is any good is not, and an algorithm ranking her work by
// taste would be the wrong thing to build even if it worked.

// Laplacian variance. A sharp frame has strong edges and a high variance; a soft
// one has weak edges and a low one. Computed on a small greyscale copy, which is
// enough to tell the difference and costs almost nothing.
function sharpness(data, w, h) {
  const grey = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    grey[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = -4 * grey[i] + grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// How much of the frame is pinned at either end. A few blown highlights are
// normal; a frame that is mostly white or mostly black usually is not.
function exposure(data, w, h) {
  let dark = 0, bright = 0;
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    if (l < 12)  dark++;
    if (l > 245) bright++;
  }
  return { darkPct: dark / total, brightPct: bright / total };
}

// A difference hash. The image is squashed to 9x8 greyscale and each pixel
// compared with the one to its right, giving 64 bits that describe the shape of
// the picture rather than its pixels. Two frames from the same burst differ in
// only a handful of those bits; two different photographs differ in dozens.
//
// Robust to the things that should not matter -- exposure, small crops, a
// slight change of angle -- which is exactly what makes it useful for finding
// the five near-identical frames where only one is wanted.
function differenceHash(bitmap) {
  const W = 9, H = 8;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;

  let bits = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      const j = (y * W + x + 1) * 4;
      const a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const b = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      bits += a > b ? '1' : '0';
    }
  }
  // Hex, so it stores compactly and compares quickly.
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

self.onmessage = async (e) => {
  const { id, file, maxPx, quality, blurThreshold = 60 } = e.data;
  try {
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Measured on a small copy — 240px is plenty for both, and reading a full
    // resolution frame back out of the canvas is the expensive part.
    let metrics = null;
    try {
      const mw = 240, mh = Math.max(1, Math.round((h / w) * mw));
      const small = new OffscreenCanvas(mw, mh);
      const sctx = small.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(bitmap, 0, 0, mw, mh);
      const px = sctx.getImageData(0, 0, mw, mh).data;

      const sharp = sharpness(px, mw, mh);
      const { darkPct, brightPct } = exposure(px, mw, mh);

      // One reason, the most serious first. Several reasons at once is noise;
      // she needs to know why it is here, not everything that is imperfect.
      let flag = null;
      if (sharp < blurThreshold / 3)      flag = 'very soft';
      else if (sharp < blurThreshold)     flag = 'soft focus';
      else if (brightPct > 0.35)          flag = 'very bright';
      else if (darkPct   > 0.55)          flag = 'very dark';

      metrics = {
        sharp: Math.round(sharp),
        darkPct: +darkPct.toFixed(3),
        brightPct: +brightPct.toFixed(3),
        flag,
        hash: differenceHash(bitmap),
      };
    } catch { /* a failed measurement must never fail the upload */ }

    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ id, ok: true, blob, width: w, height: h, metrics });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};