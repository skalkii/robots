import { useEffect, useId, useRef, useState } from 'react';
import type { MujocoSim, ActuatorInfo } from '../sim/MujocoSim';
import type { HumanoidControl, Side } from '../control/HumanoidControl';
import type { Recorder, RecorderState, SerializedTrajectory } from '../control/Recorder';
import { deserializeTrajectory, serializeTrajectory } from '../control/Recorder';
import type { ToastKind } from './Toast';

interface Props {
  sim: MujocoSim;
  control: HumanoidControl | null;
  recorder: Recorder | null;
  paused: boolean;
  onTogglePaused: () => void;
  followEnabled: boolean;
  onToggleFollow: () => void;
  /** Optional toast publisher for command failures (replaces blocking
   *  `alert()` modals). */
  onToast?: (kind: ToastKind, message: string) => void;
}

export function ControlsPanel({
  sim,
  control,
  recorder,
  paused,
  onTogglePaused,
  followEnabled,
  onToggleFollow,
  onToast,
}: Props) {
  const [actuators] = useState<ActuatorInfo[]>(() => sim.actuators());
  const [values, setValues] = useState<number[]>(() => Array.from({ length: actuators.length }, () => 0));
  const [recorderState, setRecorderState] = useState<RecorderState>('idle');
  const [hasTrajectory, setHasTrajectory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const idPrefix = useId();

  // Subscribe to recorder state so the buttons reflect record/play/idle.
  useEffect(() => {
    if (!recorder) return;
    const tick = () => {
      setRecorderState(recorder.getState());
      setHasTrajectory(recorder.getTrajectory() !== null);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [recorder]);

  // Sliders are write-only inputs. Each change writes `data.ctrl[i]` directly
  // and releases the matching PD target on `control` so the PD loop doesn't
  // overwrite the manual value on the next tick.
  const handleChange = (i: number, v: number) => {
    setValues(prev => {
      const next = prev.slice();
      next[i] = v;
      return next;
    });
    sim.setCtrl(i, v);
    control?.release(actuators[i].name);
  };

  const handleReset = () => {
    sim.reset();
    control?.goLimp();
    setValues(values.map(() => 0));
  };

  const handleZeroCtrl = () => {
    const zeros = values.map(() => 0);
    setValues(zeros);
    for (let i = 0; i < zeros.length; i++) sim.setCtrl(i, 0);
    control?.clearTargets();
  };

  const runCommand = (fn: () => void) => {
    try { fn(); }
    catch (err) {
      const msg = (err as Error).message;
      console.warn(err);
      onToast?.('error', msg);
    }
  };

  const commandSide = (action: (side: Side) => void) => ({
    left: () => runCommand(() => action('left')),
    right: () => runCommand(() => action('right')),
  });

  const arm90 = commandSide(s => control?.raiseArm(s, 90));
  const armDown = commandSide(s => control?.lowerArm(s));
  const elbow90 = commandSide(s => control?.bendElbow(s, 90));

  const startRecord = () => runCommand(() => recorder?.startRecording());
  const stopRecord = () => runCommand(() => recorder?.stop());
  const playRecord = () => runCommand(() => {
    const t = recorder?.getTrajectory();
    if (!t) { onToast?.('warn', 'No trajectory recorded yet'); return; }
    recorder?.play(t);
  });

  const saveRecord = () => runCommand(() => {
    const t = recorder?.getTrajectory();
    if (!t) { onToast?.('warn', 'No trajectory recorded yet'); return; }
    const json = JSON.stringify(serializeTrajectory(t));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const loadRecord = (file: File) => runCommand(async () => {
    const text = await file.text();
    const parsed = JSON.parse(text) as SerializedTrajectory;
    const traj = deserializeTrajectory(parsed);
    if (!recorder) return;
    recorder.play(traj);
  });

  return (
    <aside className="controls" aria-label="Robot controls">
      <header className="controls-header">
        <h2>Actuators</h2>
        <div className="buttons">
          <button onClick={onTogglePaused} aria-pressed={paused}>{paused ? 'Resume' : 'Pause'}</button>
          <button onClick={handleZeroCtrl}>Zero ctrl</button>
          <button onClick={handleReset}>Reset sim</button>
        </div>
        <div className="buttons">
          <button onClick={onToggleFollow} aria-pressed={followEnabled}>
            Follow: {followEnabled ? 'on' : 'off'}
          </button>
        </div>
        {control && (
          <div className="commands">
            <div className="commands-label" id={`${idPrefix}-commands-label`}>Commands</div>
            <div className="commands-grid" role="group" aria-labelledby={`${idPrefix}-commands-label`}>
              <button onClick={arm90.left}>Raise L arm</button>
              <button onClick={arm90.right}>Raise R arm</button>
              <button onClick={armDown.left}>Lower L</button>
              <button onClick={armDown.right}>Lower R</button>
              <button onClick={elbow90.left}>Bend L elbow</button>
              <button onClick={elbow90.right}>Bend R elbow</button>
              <button className="span2" onClick={() => runCommand(() => control.stand())}>
                Stand (PD only)
              </button>
              <button className="span2" onClick={() => runCommand(() => control.stand({ pinRoot: true }))}>
                Stand (pinned root)
              </button>
              <button onClick={() => runCommand(() => control.walk('forward', 1))}>Walk fwd 1m</button>
              <button onClick={() => runCommand(() => control.walk('backward', 1))}>Walk back 1m</button>
              <button onClick={() => runCommand(() => control.turn(90))}>Turn L 90°</button>
              <button onClick={() => runCommand(() => control.turn(-90))}>Turn R 90°</button>
              <button className="span2" onClick={() => runCommand(() => control.cancelMotion())}>
                Stop motion
              </button>
              <button className="span2" onClick={() => runCommand(() => control.goLimp())}>
                Release all targets
              </button>
            </div>
          </div>
        )}
        {recorder && (
          <div className="commands">
            <div className="commands-label">
              Record / replay {recorderState !== 'idle' && <span className="rec-badge">● {recorderState}</span>}
            </div>
            <div className="commands-grid">
              {recorderState === 'recording' ? (
                <button className="span2" onClick={stopRecord}>Stop recording</button>
              ) : (
                <button className="span2" onClick={startRecord}>Record</button>
              )}
              <button onClick={playRecord} disabled={!hasTrajectory || recorderState !== 'idle'}>
                Replay
              </button>
              <button onClick={stopRecord} disabled={recorderState !== 'playing'}>
                Stop playback
              </button>
              <button onClick={saveRecord} disabled={!hasTrajectory}>Save…</button>
              <button onClick={() => fileInputRef.current?.click()}>Load…</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) loadRecord(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}
      </header>
      <ul className="actuator-list">
        {actuators.map(a => {
          const id = `${idPrefix}-act-${a.index}`;
          return (
            <li key={a.index}>
              <label htmlFor={id}>
                <span className="name">{a.name}</span>
                <span className="value">{values[a.index].toFixed(2)}</span>
              </label>
              <input
                id={id}
                type="range"
                min={a.range[0]}
                max={a.range[1]}
                step={(a.range[1] - a.range[0]) / 200}
                value={values[a.index]}
                onChange={e => handleChange(a.index, parseFloat(e.target.value))}
                aria-valuemin={a.range[0]}
                aria-valuemax={a.range[1]}
                aria-valuenow={values[a.index]}
              />
              <span className="range">
                [{a.range[0].toFixed(1)}, {a.range[1].toFixed(1)}]
                {!a.hasExplicitRange && <em title="No explicit ctrlrange in MJCF; defaulted"> *</em>}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
