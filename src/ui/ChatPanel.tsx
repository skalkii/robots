import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn } from '../agent/AgentClient';
import { MockAgent } from '../agent/MockAgent';
import { ClaudeAgent } from '../agent/ClaudeAgent';
import { SpeechRecognizer } from '../agent/SpeechRecognizer';

type Provider = 'mock' | 'claude';

interface ChatTurn {
  id: number;
  role: 'user' | 'agent' | 'error';
  text: string;
  tools?: AgentTurn['tools'];
}

interface Props {
  control: HumanoidControl;
}

const STORE_PROVIDER = 'robots.agent.provider';
const STORE_API_KEY = 'robots.agent.apiKey';

export function ChatPanel({ control }: Props) {
  const [provider, setProvider] = useState<Provider>(() => (localStorage.getItem(STORE_PROVIDER) as Provider) || 'mock');
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem(STORE_API_KEY) || '');
  const [draftKey, setDraftKey] = useState<string>(apiKey);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const idRef = useRef(0);
  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const speechSupported =
    recognizerRef.current?.supported ??
    (typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition));

  const agent: AgentClient = useMemo(() => {
    if (provider === 'claude' && apiKey) return new ClaudeAgent(apiKey);
    return new MockAgent();
  }, [provider, apiKey]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' });
  }, [turns]);

  const nextId = useCallback(() => ++idRef.current, []);

  const submit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    setInterim('');
    setTurns(prev => [...prev, { id: nextId(), role: 'user', text: trimmed }]);
    setBusy(true);
    try {
      const turn = await agent.respond(trimmed, control);
      setTurns(prev => [...prev, { id: nextId(), role: 'agent', text: turn.text, tools: turn.tools }]);
    } catch (err) {
      setTurns(prev => [
        ...prev,
        { id: nextId(), role: 'error', text: (err as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  }, [agent, busy, control, nextId]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(input);
  };

  const ensureRecognizer = useCallback(() => {
    if (recognizerRef.current) return recognizerRef.current;
    const r = new SpeechRecognizer({
      onInterim: text => setInterim(text),
      onFinal: text => {
        setInterim('');
        // Auto-submit the final transcript.
        submit(text);
      },
      onError: msg => {
        setInterim('');
        setListening(false);
        setTurns(prev => [...prev, { id: nextId(), role: 'error', text: `speech: ${msg}` }]);
      },
      onEnd: () => {
        setListening(false);
        setInterim('');
      },
    });
    recognizerRef.current = r;
    return r;
  }, [nextId, submit]);

  const toggleMic = () => {
    const r = ensureRecognizer();
    if (!r.supported) return;
    if (r.isRunning) {
      r.stop();
      setListening(false);
    } else {
      r.start();
      setListening(true);
    }
  };

  useEffect(() => () => recognizerRef.current?.abort(), []);

  const saveSettings = () => {
    localStorage.setItem(STORE_PROVIDER, provider);
    localStorage.setItem(STORE_API_KEY, draftKey);
    setApiKey(draftKey);
    setSettingsOpen(false);
  };

  return (
    <section className="chat">
      <header className="chat-header">
        <h2>Agent</h2>
        <span className="agent-label">{agent.label}</span>
        <button className="chat-settings" onClick={() => setSettingsOpen(o => !o)} aria-label="Settings">
          ⚙
        </button>
      </header>

      {settingsOpen && (
        <div className="chat-settings-pane">
          <label className="provider-row">
            <span>Provider</span>
            <select value={provider} onChange={e => setProvider(e.target.value as Provider)}>
              <option value="mock">Mock (offline regex)</option>
              <option value="claude">Claude Haiku 4.5 (API)</option>
            </select>
          </label>
          <label className="key-row">
            <span>Anthropic API key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-ant-…"
              value={draftKey}
              onChange={e => setDraftKey(e.target.value)}
            />
          </label>
          <p className="key-warning">
            Stored in your browser's localStorage. Never share this app's URL with the key embedded.
          </p>
          <div className="settings-buttons">
            <button onClick={saveSettings}>Save</button>
            <button onClick={() => { setDraftKey(apiKey); setSettingsOpen(false); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="chat-transcript" ref={transcriptRef}>
        {turns.length === 0 && (
          <div className="chat-empty">
            Try: "raise your right arm", "bend left elbow to 90", "stand and don't fall".
          </div>
        )}
        {turns.map(t => (
          <div key={t.id} className={`turn turn-${t.role}`}>
            <div className="turn-text">{t.text}</div>
            {t.tools && t.tools.length > 0 && (
              <ul className="tool-trace">
                {t.tools.map((tc, i) => (
                  <li key={i} className={tc.result.ok ? 'tool-ok' : 'tool-err'}>
                    <code>{tc.call.name}</code>
                    {Object.keys(tc.call.input).length > 0 && (
                      <span className="tool-args">({JSON.stringify(tc.call.input)})</span>
                    )}
                    <span className="tool-result"> → {tc.result.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="turn turn-agent loading">…thinking</div>}
      </div>

      <form className="chat-input" onSubmit={onSubmit}>
        <button
          type="button"
          className={`mic ${listening ? 'mic-on' : ''}`}
          onClick={toggleMic}
          disabled={!speechSupported || busy}
          title={speechSupported ? (listening ? 'Stop listening' : 'Speak') : 'Speech recognition not supported in this browser'}
          aria-label="Toggle microphone"
        >
          {listening ? '■' : '🎙'}
        </button>
        <input
          type="text"
          placeholder={
            listening
              ? interim || 'Listening…'
              : busy
                ? 'Working…'
                : 'Tell the robot what to do'
          }
          value={listening ? interim : input}
          onChange={e => setInput(e.target.value)}
          disabled={busy || listening}
        />
        <button type="submit" disabled={busy || listening || !input.trim()}>Send</button>
      </form>
    </section>
  );
}
