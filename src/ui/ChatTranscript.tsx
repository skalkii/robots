import { useEffect, useRef, useState } from 'react';
import type { AgentTurn } from '../agent/AgentClient';

export interface ChatTurn {
  id: number;
  role: 'user' | 'agent' | 'error';
  text: string;
  tools?: AgentTurn['tools'];
  usage?: AgentTurn['usage'];
  truncated?: boolean;
}

interface Props {
  turns: ChatTurn[];
  busy: boolean;
}

export function ChatTranscript({ turns, busy }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (!ref.current || !stick) return;
    ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy, stick]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStick(atBottom);
  };

  return (
    <div className="chat-transcript" ref={ref} onScroll={onScroll}>
      {turns.length === 0 && (
        <div className="chat-empty">
          Try: "raise your right arm", "bend left elbow to 90", "walk forward 2 then turn left 90".
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
          {t.usage && (
            <div className="turn-usage">
              tokens: {t.usage.inputTokens} in · {t.usage.outputTokens} out
              {t.usage.cacheReadTokens != null && ` · ${t.usage.cacheReadTokens} cache`}
              {t.truncated && ' · ⚠ truncated'}
            </div>
          )}
        </div>
      ))}
      {busy && <div className="turn turn-agent loading">…thinking</div>}
      {!stick && (
        <div className="scroll-hint">↓ scrolled up; new replies won't auto-scroll</div>
      )}
    </div>
  );
}
