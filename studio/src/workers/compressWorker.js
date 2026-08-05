// studio/src/workers/compressWorker.js
// Resizing and re-encoding a photo, off the main thread.
//
// This is the whole bottleneck of a large upload. createImageBitmap decodes
// off-thread, but drawImage and the JPEG encode do not — so five parallel
// uploads all queued behind one thread doing the work, throughput capped at
// about 39 photos a minute, and Studio froze for the duration.
//
// A worker gets its own thread. Several get several, which is the only way to
// use more than one core for this.

self.onmessage = async (e) => {
  const { id, file, maxPx, quality } = e.data;
  try {
    const bitmap = await createImageBitmap(file);
    const scale  = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ id, ok: true, blob, width: w, height: h });
  } catch (err) {
    // The original is returned rather than failing outright — some formats
    // (HEIC on older browsers) cannot be decoded here, and sending a large file
    // is better than losing the photo.
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};