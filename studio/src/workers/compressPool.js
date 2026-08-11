// studio/src/workers/compressPool.js
// A small pool of compression workers.
//
// Sized to the machine rather than a fixed number: hardwareConcurrency reports
// the cores available, and one is left free so the interface stays responsive
// while the rest are busy. Capped at 3 because each worker holds a decoded
// bitmap — a 12MP photo is around 48MB decoded — and a browser that runs out of
// memory mid-upload fails in ways that look like network problems.

const MAX_WORKERS = 3;

export function createCompressPool({ maxPx = 2048, quality = 0.85, blurThreshold = 60 } = {}) {
  const size = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 4) - 1));

  const workers = [];
  const idle    = [];
  const queue   = [];
  const pending = new Map();
  let nextId = 0;
  let disposed = false;

  const spawn = () => {
    const w = new Worker(new URL('./compressWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, ok, blob, error, metrics } = e.data;
      const job = pending.get(id);
      pending.delete(id);
      idle.push(w);
      pump();
      if (!job) return;
      if (ok) job.resolve({ file: new File([blob], job.name, { type: 'image/jpeg' }), metrics });
      else    job.reject(new Error(error || 'compression failed'));
    };
    w.onerror = (err) => {
      // A worker that dies takes its job with it. The job falls back to the
      // original file rather than being lost, and the worker is replaced so the
      // pool does not quietly shrink to nothing over a long upload.
      console.error('compress worker error:', err.message);
      for (const [id, job] of pending) {
        if (job.worker === w) { pending.delete(id); job.reject(new Error('worker died')); }
      }
      const i = workers.indexOf(w);
      if (i >= 0) workers.splice(i, 1);
      const j = idle.indexOf(w);
      if (j >= 0) idle.splice(j, 1);
      if (!disposed) spawn();
    };
    workers.push(w);
    idle.push(w);
  };

  for (let i = 0; i < size; i++) spawn();

  function pump() {
    while (idle.length && queue.length) {
      const w   = idle.pop();
      const job = queue.shift();
      job.worker = w;
      pending.set(job.id, job);
      w.postMessage({ id: job.id, file: job.file, maxPx, quality, blurThreshold });
    }
  }

  return {
    size,
    // Resolves to { file, metrics }. Never rejects — losing a photo to a codec
    // quirk would be worse than uploading a large one unmeasured.
    compress(file) {
      if (disposed) return Promise.resolve({ file, metrics: null });
      return new Promise((resolve) => {
        const job = {
          id: nextId++,
          file,
          name: file.name.replace(/\.[^.]+$/, '.jpg'),
          resolve,
          reject: () => resolve({ file, metrics: null }),
        };
        queue.push(job);
        pump();
      });
    },
    dispose() {
      disposed = true;
      workers.forEach((w) => w.terminate());
      workers.length = 0;
      idle.length = 0;
      queue.length = 0;
      pending.clear();
    },
  };
}