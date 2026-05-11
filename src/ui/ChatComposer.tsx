import { useEffect, useRef, type FormEvent } from 'react';

interface Props {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (text: string) => void;
  busy: boolean;
  listening: boolean;
  interim: string;
  onToggleMic: () => void;
  micSupported: boolean;
  cameraOn: boolean;
  onToggleCamera: () => void;
  cameraSupported: boolean;
}

export function ChatComposer({
  input, setInput, onSubmit, busy, listening, interim,
  onToggleMic, micSupported, cameraOn, onToggleCamera, cameraSupported,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(input);
  };

  const canSend = !busy && !listening && input.trim().length > 0;

  return (
    <form className="chat-input" onSubmit={submit}>
      <button
        type="button"
        className={`mic ${listening ? 'mic-on' : ''}`}
        onClick={onToggleMic}
        disabled={!micSupported || busy}
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Start microphone'}
        title={micSupported ? (listening ? 'Stop listening' : 'Speak (mic)') : 'Speech recognition not supported in this browser'}
      >
        {listening ? '■' : '🎙'}
      </button>
      <input
        ref={inputRef}
        type="text"
        placeholder={
          listening ? interim || 'Listening…'
          : busy ? 'Working…'
          : 'Tell the robot what to do (Cmd/Ctrl+K)'
        }
        value={listening ? interim : input}
        onChange={e => setInput(e.target.value)}
        disabled={busy || listening}
        aria-label="Command for the humanoid"
      />
      <button type="submit" disabled={!canSend} aria-label="Send command">Send</button>
      <button
        type="button"
        className={`cam ${cameraOn ? 'cam-on' : ''}`}
        onClick={onToggleCamera}
        disabled={!cameraSupported || busy}
        aria-pressed={cameraOn}
        aria-label={cameraOn ? 'Disable webcam' : 'Enable webcam'}
        title={cameraSupported ? (cameraOn ? 'Disable webcam' : 'Enable webcam — attaches one frame per message') : 'Webcam not supported'}
      >
        📷<span className="dot" aria-hidden="true" />
      </button>
    </form>
  );
}
