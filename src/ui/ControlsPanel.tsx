import { useEffect, useState } from 'react';
import type { MujocoSim, ActuatorInfo } from '../sim/MujocoSim';
import type { HumanoidControl, Side } from '../control/HumanoidControl';

interface Props {
  sim: MujocoSim;
  control: HumanoidControl | null;
  paused: boolean;
  onTogglePaused: () => void;
}

export function ControlsPanel({ sim, control, paused, onTogglePaused }: Props) {
  const [actuators] = useState<ActuatorInfo[]>(() => sim.actuators());
  const [values, setValues] = useState<number[]>(() => Array.from({ length: actuators.length }, () => 0));

  useEffect(() => {
    for (let i = 0; i < values.length; i++) sim.setCtrl(i, values[i]);
  }, [sim, values]);

  const handleChange = (i: number, v: number) => {
    setValues(prev => {
      const next = prev.slice();
      next[i] = v;
      return next;
    });
  };

  const handleReset = () => {
    sim.reset();
    setValues(values.map(() => 0));
  };

  const handleZeroCtrl = () => {
    setValues(values.map(() => 0));
  };

  const runCommand = (fn: () => void) => {
    try { fn(); } catch (err) { console.warn(err); alert((err as Error).message); }
  };

  const commandSide = (action: (side: Side) => void) => ({
    left: () => runCommand(() => action('left')),
    right: () => runCommand(() => action('right')),
  });

  const arm90 = commandSide(s => control?.raiseArm(s, 90));
  const armDown = commandSide(s => control?.lowerArm(s));
  const elbow90 = commandSide(s => control?.bendElbow(s, 90));

  return (
    <aside className="controls">
      <header className="controls-header">
        <h2>Actuators</h2>
        <div className="buttons">
          <button onClick={onTogglePaused}>{paused ? 'Resume' : 'Pause'}</button>
          <button onClick={handleZeroCtrl}>Zero ctrl</button>
          <button onClick={handleReset}>Reset sim</button>
        </div>
        {control && (
          <div className="commands">
            <div className="commands-label">Commands</div>
            <div className="commands-grid">
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
              <button className="span2" onClick={() => runCommand(() => control.stop())}>
                Stop motion
              </button>
              <button className="span2" onClick={() => runCommand(() => control.releaseAll())}>
                Release all targets
              </button>
            </div>
          </div>
        )}
      </header>
      <ul className="actuator-list">
        {actuators.map(a => (
          <li key={a.index}>
            <label>
              <span className="name">{a.name}</span>
              <span className="value">{values[a.index].toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={a.range[0]}
              max={a.range[1]}
              step={(a.range[1] - a.range[0]) / 200}
              value={values[a.index]}
              onChange={e => handleChange(a.index, parseFloat(e.target.value))}
            />
            <span className="range">
              [{a.range[0].toFixed(1)}, {a.range[1].toFixed(1)}]
              {!a.hasExplicitRange && <em> *</em>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
