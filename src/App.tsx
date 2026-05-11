import { useEffect, useRef, useState } from 'react';
import { MujocoSim } from './sim/MujocoSim';
import { Scene } from './render/Scene';
import { HumanoidControl } from './control/HumanoidControl';
import { ControlsPanel } from './ui/ControlsPanel';
import { ChatPanel } from './ui/ChatPanel';
import './App.css';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState('booting…');
  const [sim, setSim] = useState<MujocoSim | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [control, setControl] = useState<HumanoidControl | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let localScene: Scene | null = null;
    let localSim: MujocoSim | null = null;
    let localControl: HumanoidControl | null = null;
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

        localControl = new HumanoidControl(localSim);

        setSim(localSim);
        setScene(localScene);
        setControl(localControl);
      } catch (err) {
        console.error(err);
        setStatus(`error: ${(err as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      localControl?.dispose();
      localScene?.stop();
      localSim?.dispose();
      setSim(null);
      setScene(null);
      setControl(null);
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
      {sim && (
        <ControlsPanel
          sim={sim}
          control={control}
          paused={paused}
          onTogglePaused={togglePaused}
        />
      )}
      {control && <ChatPanel control={control} />}
    </div>
  );
}
