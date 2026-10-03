/** Records a canvas that is being redrawn in real time, for a visual's Video export. MP4 when the runtime can
 *  encode it (it opens everywhere, including PowerPoint), otherwise WebM. */
export function videoFormat() {
  const mp4 = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'].find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  if (mp4) return { mime: mp4, ext: 'mp4' };
  const webm = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  return webm ? { mime: webm, ext: 'webm' } : null;
}

export function recordCanvas(canvas: HTMLCanvasElement, seconds: number): Promise<{ blob: Blob; ext: string }> {
  const format = videoFormat();
  if (!format || !canvas.captureStream) return Promise.reject(Error('Video recording is not available here.'));
  const stream = canvas.captureStream(30), recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 6_000_000 }), parts: Blob[] = [];
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    recorder.onerror = () => reject(Error('The video could not be recorded.'));
    recorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); resolve({ blob: new Blob(parts, { type: format.mime.split(';')[0] }), ext: format.ext }); };
    recorder.start(250);
    setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), Math.max(1, seconds) * 1000);
  });
}

/** Paints an SVG string onto a canvas (used to film figures, which are drawn as SVG). Resolves once painted. */
export function paintSvg(canvas: HTMLCanvasElement, svg: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), image = new Image();
  return new Promise<void>(resolve => {
    image.onload = () => { const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url); resolve(); };
    image.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    image.src = url;
  });
}
