import { useEffect, useRef, useState } from 'react';
import type { Provider } from './useChatAgent';

interface Props {
  provider: Provider;
  apiKey: string;
  onSave: (provider: Provider, apiKey: string) => void;
  onClose: () => void;
  onResetConversation: () => void;
}

export function ChatSettings({ provider, apiKey, onSave, onClose, onResetConversation }: Props) {
  const [draftProvider, setDraftProvider] = useState<Provider>(provider);
  const [draftKey, setDraftKey] = useState<string>(apiKey);
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
        Stored in your browser's localStorage in plaintext. Anyone with access to
        this browser (or an XSS bug) can read it. Never share an URL with the
        key embedded; for production, proxy through a server you control.
      </p>
      <div className="settings-buttons">
        <button type="button" onClick={onResetConversation}>Reset chat history</button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" onClick={() => onSave(draftProvider, draftKey)}>Save</button>
      </div>
    </div>
  );
}
