import { useEffect, useRef, useState } from 'react';
import { MujocoSim } from './sim/MujocoSim';
import { Scene } from './render/Scene';
import './App.css';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState('booting…');
  const [info, setInfo] = useState<{ ngeom: number; nbody: number; nu: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: Scene | null = null;
    let sim: MujocoSim | null = null;
    let cancelled = false;

    (async () => {
      try {
        setStatus('fetching MJCF…');
        const xml = await (await fetch('/assets/humanoid.xml')).text();
        if (cancelled) return;

        setStatus('loading MuJoCo WASM…');
        sim = await MujocoSim.load(xml);
        if (cancelled) { sim.dispose(); return; }

        setStatus('rendering');
        scene = new Scene(canvas);
        scene.attachSim(sim);
        scene.start();
        setInfo({ ngeom: sim.ngeom, nbody: sim.nbody, nu: sim.nu });
      } catch (err) {
        console.error(err);
        setStatus(`error: ${(err as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      scene?.stop();
      sim?.dispose();
    };
  }, []);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="viewport" />
      <div className="hud">
        <div className="status">{status}</div>
        {info && (
          <div className="info">
            geoms: {info.ngeom} · bodies: {info.nbody} · actuators: {info.nu}
          </div>
        )}
      </div>
    </div>
  );
}
