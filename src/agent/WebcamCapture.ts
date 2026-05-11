export interface CapturedFrame {
  /** Plain base64 (no data: URL prefix), ready for the Anthropic image block. */
  base64: string;
  mediaType: 'image/jpeg';
  width: number;
  height: number;
}

export interface WebcamCaptureOptions {
  videoEl: HTMLVideoElement;
  maxEdge?: number;
  quality?: number;
  onError?: (message: string) => void;
}

export class WebcamCapture {
  private opts: WebcamCaptureOptions;
  private stream: MediaStream | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(opts: WebcamCaptureOptions) {
    this.opts = opts;
  }

  get active(): boolean { return this.stream !== null; }
  get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(): Promise<boolean> {
    if (this.stream) return true;
    if (!this.supported) {
      this.opts.onError?.('webcam not supported in this browser');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this.opts.videoEl.srcObject = this.stream;
      this.opts.videoEl.muted = true;
      this.opts.videoEl.playsInline = true;
      await this.opts.videoEl.play();
      return true;
    } catch (err) {
      this.opts.onError?.((err as Error).message);
      return false;
    }
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.opts.videoEl.srcObject = null;
  }

  captureFrame(): CapturedFrame | null {
    if (!this.stream) return null;
    const video = this.opts.videoEl;
    const w0 = video.videoWidth;
    const h0 = video.videoHeight;
    if (!w0 || !h0) return null;

    const maxEdge = this.opts.maxEdge ?? 768;
    const scale = Math.min(1, maxEdge / Math.max(w0, h0));
    const w = Math.round(w0 * scale);
    const h = Math.round(h0 * scale);

    if (!this.canvas) this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = this.canvas.toDataURL('image/jpeg', this.opts.quality ?? 0.75);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return { base64, mediaType: 'image/jpeg', width: w, height: h };
  }
}
