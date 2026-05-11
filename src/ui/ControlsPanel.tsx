import { useEffect, useState } from 'react';
import type { MujocoSim, ActuatorInfo } from '../sim/MujocoSim';

interface Props {
  sim: MujocoSim;
  paused: boolean;
  onTogglePaused: () => void;
}

export function ControlsPanel({ sim, paused, onTogglePaused }: Props) {
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

  return (
    <aside className="controls">
      <header className="controls-header">
        <h2>Actuators</h2>
        <div className="buttons">
          <button onClick={onTogglePaused}>{paused ? 'Resume' : 'Pause'}</button>
          <button onClick={handleZeroCtrl}>Zero ctrl</button>
          <button onClick={handleReset}>Reset sim</button>
        </div>
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
