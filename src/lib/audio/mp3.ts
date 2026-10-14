export function encodeMp3(left: Float32Array, right: Float32Array, rate: number, kbps = 128, onProgress?: (p: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mp3.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      if (e.data.progress !== undefined) onProgress?.(e.data.progress);
      if (e.data.done) {
        worker.terminate();
        resolve(e.data.blob);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "MP3 encoding failed"));
    };
    worker.postMessage({ left, right, rate, kbps });
  });
}
