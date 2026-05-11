import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn } from '../agent/AgentClient';
import { MockAgent } from '../agent/MockAgent';
import { ClaudeAgent } from '../agent/ClaudeAgent';

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
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const idRef = useRef(0);

  const agent: AgentClient = useMemo(() => {
    if (provider === 'claude' && apiKey) return new ClaudeAgent(apiKey);
    return new MockAgent();
  }, [provider, apiKey]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' });
  }, [turns]);

  const nextId = () => ++idRef.current;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setTurns(prev => [...prev, { id: nextId(), role: 'user', text }]);
    setBusy(true);
    try {
      const turn = await agent.respond(text, control);
      setTurns(prev => [...prev, { id: nextId(), role: 'agent', text: turn.text, tools: turn.tools }]);
    } catch (err) {
      setTurns(prev => [
        ...prev,
        { id: nextId(), role: 'error', text: (err as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  };

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
        <input
          type="text"
          placeholder={busy ? 'Working…' : 'Tell the robot what to do'}
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </section>
  );
}
