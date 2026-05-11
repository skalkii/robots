import { useEffect, useRef, useState } from 'react';
import { MujocoSim } from './sim/MujocoSim';
import { Scene } from './render/Scene';
import { ControlsPanel } from './ui/ControlsPanel';
import './App.css';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState('booting…');
  const [sim, setSim] = useState<MujocoSim | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let localScene: Scene | null = null;
    let localSim: MujocoSim | null = null;
    let cancelled = false;

    (async () => {
      try {
        setStatus('fetching MJCF…');
        const xml = await (await fetch('/assets/humanoid.xml')).text();
        if (cancelled) return;

        setStatus('loading MuJoCo WASM…');
        localSim = await MujocoSim.load(xml);
        if (cancelled) { localSim.dispose(); return; }

        setStatus('rendering');
        localScene = new Scene(canvas);
        localScene.attachSim(localSim);
        localScene.start();

        setSim(localSim);
        setScene(localScene);
      } catch (err) {
        console.error(err);
        setStatus(`error: ${(err as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      localScene?.stop();
      localSim?.dispose();
      setSim(null);
      setScene(null);
    };
  }, []);

  const togglePaused = () => {
    if (!scene) return;
    scene.paused = !scene.paused;
    setPaused(scene.paused);
  };

  return (
    <div className="app">
      <canvas ref={canvasRef} className="viewport" />
      <div className="hud">
        <div className="status">{status}</div>
        {sim && (
          <div className="info">
            geoms: {sim.ngeom} · bodies: {sim.nbody} · actuators: {sim.nu}
            {paused && <span className="paused"> · PAUSED</span>}
          </div>
        )}
      </div>
      {sim && <ControlsPanel sim={sim} paused={paused} onTogglePaused={togglePaused} />}
    </div>
  );
}
