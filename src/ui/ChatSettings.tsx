import { useEffect, useRef, useState } from 'react';
import type { Provider } from './useChatAgent';

interface Props {
  provider: Provider;
  apiKey: string;
  proxyEndpoint: string;
  onSave: (provider: Provider, apiKey: string, proxyEndpoint: string) => void;
  onClose: () => void;
  onResetConversation: () => void;
}

export function ChatSettings({
  provider,
  apiKey,
  proxyEndpoint,
  onSave,
  onClose,
  onResetConversation,
}: Props) {
  const [draftProvider, setDraftProvider] = useState<Provider>(provider);
  const [draftKey, setDraftKey] = useState<string>(apiKey);
  const [draftEndpoint, setDraftEndpoint] = useState<string>(proxyEndpoint);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select, input, button')?.focus();
  }, []);

  return (
    <div className="chat-settings-pane" ref={ref} role="dialog" aria-label="Agent settings">
      <label className="provider-row">
        <span>Provider</span>
        <select value={draftProvider} onChange={e => setDraftProvider(e.target.value as Provider)}>
          <option value="mock">Mock (offline regex)</option>
          <option value="claude">Claude Haiku 4.5 (direct browser)</option>
          <option value="server">Server proxy (recommended for prod)</option>
        </select>
      </label>
      {draftProvider === 'claude' && (
        <>
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
            Stored in your browser's localStorage in plaintext. An XSS bug or
            malicious extension can read it. For production, switch to the
            server proxy option.
          </p>
        </>
      )}
      {draftProvider === 'server' && (
        <>
          <label className="key-row">
            <span>Proxy endpoint URL</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="/api/agent"
              value={draftEndpoint}
              onChange={e => setDraftEndpoint(e.target.value)}
            />
          </label>
          <p className="key-warning">
            The proxy receives the same payload as the Anthropic Messages API
            (model, system, tools, messages) and is responsible for adding
            credentials server-side. See <code>server/agent-proxy.example.mjs</code>.
          </p>
        </>
      )}
      <div className="settings-buttons">
        <button type="button" onClick={onResetConversation}>Reset chat history</button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={() => onSave(draftProvider, draftKey, draftEndpoint)}>Save</button>
      </div>
    </div>
  );
}
