// The Web Speech API's SpeechRecognition constructor isn't typed in
// TypeScript's bundled lib.dom.d.ts (only its event/result interfaces are).
// Declare just enough surface to use it safely.
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => unknown) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => unknown) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => unknown) | null;
}
interface SpeechRecognitionCtor {
  new (): SpeechRecognitionInstance;
}
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export interface SpeechRecognizerOptions {
  lang?: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

export class SpeechRecognizer {
  private rec: SpeechRecognitionInstance | null = null;
  private opts: SpeechRecognizerOptions;
  private running = false;

  constructor(opts: SpeechRecognizerOptions = {}) {
    this.opts = opts;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = false;
    r.interimResults = true;
    r.lang = opts.lang ?? 'en-US';
    r.maxAlternatives = 1;
    r.onresult = ev => this.handleResult(ev);
    r.onerror = ev => this.opts.onError?.(ev.error || 'unknown error');
    r.onend = () => {
      this.running = false;
      this.opts.onEnd?.();
    };
    this.rec = r;
  }

  get supported(): boolean { return this.rec !== null; }
  get isRunning(): boolean { return this.running; }

  start() {
    if (!this.rec || this.running) return;
    try {
      this.rec.start();
      this.running = true;
    } catch (err) {
      this.opts.onError?.((err as Error).message);
    }
  }

  stop() {
    if (!this.rec || !this.running) return;
    this.rec.stop();
  }

  abort() {
    if (!this.rec) return;
    this.rec.abort();
    this.running = false;
  }

  private handleResult(ev: SpeechRecognitionEvent) {
    let interim = '';
    let finalText = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const text = r[0]?.transcript ?? '';
      if (r.isFinal) finalText += text;
      else interim += text;
    }
    if (interim) this.opts.onInterim?.(interim.trim());
    if (finalText) this.opts.onFinal?.(finalText.trim());
  }
}
