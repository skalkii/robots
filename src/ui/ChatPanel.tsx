import { useCallback, useEffect, useRef, useState } from 'react';
import type { HumanoidControl } from '../control/HumanoidControl';
import { SpeechRecognizer } from '../agent/SpeechRecognizer';
import { WebcamCapture } from '../agent/WebcamCapture';
import { STORAGE_KEYS } from '../config';
import { useChatAgent, readProvider, type Provider } from './useChatAgent';
import { ChatTranscript, type ChatTurn } from './ChatTranscript';
import { ChatComposer } from './ChatComposer';
import { ChatSettings } from './ChatSettings';
import type { ToastKind } from './Toast';

interface Props {
  control: HumanoidControl;
  onToast?: (kind: ToastKind, message: string) => void;
}

export function ChatPanel({ control, onToast }: Props) {
  const pushToast = useCallback(
    (kind: ToastKind, message: string) => onToast?.(kind, message),
    [onToast],
  );
  const [provider, setProvider] = useState<Provider>(() => readProvider(localStorage.getItem(STORAGE_KEYS.provider)));
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.apiKey) || '');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [cameraOn, setCameraOn] = useState(false);

  const idRef = useRef(0);
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const webcamRef = useRef<WebcamCapture | null>(null);

  const speechSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  const cameraSupported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const agent = useChatAgent(provider, apiKey);

  const nextId = useCallback(() => ++idRef.current, []);

  const submit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const frame = webcamRef.current?.active ? webcamRef.current.captureFrame() : null;
    setInput('');
    setInterim('');
    const userLabel = frame ? `${trimmed}  📷` : trimmed;
    setTurns(prev => [...prev, { id: nextId(), role: 'user', text: userLabel }]);
    setBusy(true);
    try {
      const turn = await agent.respond(trimmed, control, frame);
      setTurns(prev => [...prev, {
        id: nextId(),
        role: 'agent',
        text: turn.text,
        tools: turn.tools,
        usage: turn.usage,
        truncated: turn.truncated,
      }]);
      if (turn.truncated) pushToast('warn', 'Agent reply truncated by tool-round cap.');
    } catch (err) {
      const msg = (err as Error).message;
      setTurns(prev => [...prev, { id: nextId(), role: 'error', text: msg }]);
      pushToast('error', msg);
    } finally {
      setBusy(false);
    }
  }, [agent, busy, control, nextId, pushToast]);

  const ensureRecognizer = useCallback(() => {
    if (recognizerRef.current) return recognizerRef.current;
    const r = new SpeechRecognizer({
      onInterim: text => setInterim(text),
      onFinal: text => { setInterim(''); submit(text); },
      onError: msg => {
        setInterim('');
        setListening(false);
        pushToast('error', `speech: ${msg}`);
      },
      onEnd: () => { setListening(false); setInterim(''); },
    });
    recognizerRef.current = r;
    return r;
  }, [submit, pushToast]);

  const toggleMic = () => {
    const r = ensureRecognizer();
    if (!r.supported) return;
    if (r.isRunning) { r.stop(); setListening(false); }
    else { r.start(); setListening(true); }
  };

  const toggleCamera = async () => {
    if (!cameraSupported || !videoRef.current) return;
    if (!webcamRef.current) {
      webcamRef.current = new WebcamCapture({
        videoEl: videoRef.current,
        onError: msg => {
          setCameraOn(false);
          pushToast('error', `camera: ${msg}`);
        },
      });
    }
    if (webcamRef.current.active) {
      webcamRef.current.stop();
      setCameraOn(false);
    } else {
      const ok = await webcamRef.current.start();
      setCameraOn(ok);
    }
  };

  useEffect(() => () => recognizerRef.current?.abort(), []);
  useEffect(() => () => webcamRef.current?.stop(), []);

  const saveSettings = (p: Provider, k: string) => {
    localStorage.setItem(STORAGE_KEYS.provider, p);
    localStorage.setItem(STORAGE_KEYS.apiKey, k);
    setProvider(p);
    setApiKey(k);
    setSettingsOpen(false);
    agent.resetConversation?.();
    pushToast('success', `Agent: ${p === 'claude' ? 'Claude Haiku 4.5' : 'Mock (offline)'}`);
  };

  const resetConversation = () => {
    agent.resetConversation?.();
    setTurns([]);
    pushToast('info', 'Chat history reset.');
  };

  return (
    <section className="chat">
      <header className="chat-header">
        <h2>Agent</h2>
        <span className="agent-label">{agent.label}</span>
        <button
          type="button"
          className="chat-settings"
          onClick={() => setSettingsOpen(o => !o)}
          aria-pressed={settingsOpen}
          aria-label="Agent settings"
        >
          ⚙
        </button>
      </header>

      {settingsOpen && (
        <ChatSettings
          provider={provider}
          apiKey={apiKey}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
          onResetConversation={resetConversation}
        />
      )}

      <video
        ref={videoRef}
        className={`webcam-preview ${cameraOn ? 'on' : ''}`}
        playsInline
        muted
        aria-hidden={!cameraOn}
      />

      <ChatTranscript turns={turns} busy={busy} />

      <ChatComposer
        input={input}
        setInput={setInput}
        onSubmit={submit}
        busy={busy}
        listening={listening}
        interim={interim}
        onToggleMic={toggleMic}
        micSupported={speechSupported}
        cameraOn={cameraOn}
        onToggleCamera={toggleCamera}
        cameraSupported={cameraSupported}
      />
    </section>
  );
}
