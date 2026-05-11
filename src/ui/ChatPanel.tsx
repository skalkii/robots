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
import { formatUsd } from '../agent/pricing';

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
  const [turns, setTurns] = useState<ChatTurn[]>(() => restoreTranscript());
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [cameraOn, setCameraOn] = useState(false);

  const idRef = useRef(turns.reduce((max, t) => Math.max(max, t.id), 0));

  // Persist every transcript change so a reload restores the conversation.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.transcript, JSON.stringify(turns)); }
    catch { /* quota / private */ }
  }, [turns]);
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
    const userId = nextId();
    const agentId = nextId();
    setTurns(prev => [
      ...prev,
      { id: userId, role: 'user', text: userLabel },
      { id: agentId, role: 'agent', text: '' },
    ]);
    setBusy(true);

    // Stream callback: append text deltas to the in-flight agent turn so the
    // UI renders incrementally instead of staring at "…thinking" for seconds.
    const onStream = (ev:
      | { type: 'text'; text: string }
      | { type: 'tool_start'; name: string }
      | { type: 'tool_result'; name: string; ok: boolean; message: string }) => {
      if (ev.type === 'text') {
        setTurns(prev => prev.map(t => t.id === agentId
          ? { ...t, text: t.text + ev.text }
          : t));
      }
    };

    try {
      const turn = await agent.respond(trimmed, control, frame, onStream);
      setTurns(prev => prev.map(t => t.id === agentId
        ? { ...t, text: turn.text || t.text, tools: turn.tools, usage: turn.usage, truncated: turn.truncated }
        : t));
      if (turn.truncated) pushToast('warn', 'Agent reply truncated by tool-round cap.');
    } catch (err) {
      const msg = (err as Error).message;
      setTurns(prev => prev.map(t => t.id === agentId
        ? { ...t, role: 'error', text: msg }
        : t));
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
    try { localStorage.removeItem(STORAGE_KEYS.transcript); } catch { /* quota / private */ }
    pushToast('info', 'Chat history reset.');
  };

  const sessionCost = turns.reduce(
    (sum, t) => sum + (t.usage?.costUsd ?? 0),
    0,
  );

  return (
    <section className="chat">
      <header className="chat-header">
        <h2>Agent</h2>
        <span className="agent-label">
          {agent.label}
          {sessionCost > 0 && <span className="agent-cost"> · {formatUsd(sessionCost)}</span>}
        </span>
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

function restoreTranscript(): ChatTurn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.transcript);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ChatTurn[] : [];
  } catch { return []; }
}
