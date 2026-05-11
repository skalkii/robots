import { useCallback, useEffect, useRef, useState } from 'react';
import { MujocoSim } from './sim/MujocoSim';
import { Scene } from './render/Scene';
import { HumanoidControl } from './control/HumanoidControl';
import { Recorder } from './control/Recorder';
import { ControlsPanel } from './ui/ControlsPanel';
import { ChatPanel } from './ui/ChatPanel';
import { ToastStack } from './ui/Toast';
import { useToasts } from './ui/useToasts';
import './App.css';

interface BootProgress {
  phase: 'idle' | 'fetch' | 'wasm' | 'render' | 'ready' | 'error';
  message: string;
  progress?: number; // 0..1 for the wasm fetch
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [boot, setBoot] = useState<BootProgress>({ phase: 'idle', message: 'booting…' });
  const [sim, setSim] = useState<MujocoSim | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [control, setControl] = useState<HumanoidControl | null>(null);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [paused, setPaused] = useState(false);
  const [followEnabled, setFollowEnabled] = useState(true);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
  /** Guard against React StrictMode double-mount in dev: only boot once
   *  per mount. Cleanup still disposes correctly on real unmount. */
  const bootedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (bootedRef.current) return;
    bootedRef.current = true;

    let localScene: Scene | null = null;
    let localSim: MujocoSim | null = null;
    let localControl: HumanoidControl | null = null;
    let localRecorder: Recorder | null = null;
    let cancelled = false;

    (async () => {
      try {
        setBoot({ phase: 'fetch', message: 'fetching MJCF…' });
        const xml = await (await fetch('/assets/humanoid.xml')).text();
        if (cancelled) return;

        setBoot({ phase: 'wasm', message: 'loading MuJoCo WASM…' });
        localSim = await MujocoSim.load(xml);
        if (cancelled) { localSim.dispose(); return; }

        setBoot({ phase: 'render', message: 'rendering' });
        localScene = new Scene(canvas);
        localScene.attachSim(localSim);
        const followSim = localSim;
        localScene.setFollowGetter(() => followSim.rootPos());
        localScene.start();

        localControl = new HumanoidControl(localSim);
        // Default ground-height provider: raycast straight down from above.
        // Returns null off the floor plane, in which case the control layer
        // falls back to the initial standing height.
        const groundSim = localSim;
        localControl.setGroundHeightProvider((x, y) => groundSim.rayDown(x, y));
        localRecorder = new Recorder(localSim, { control: localControl });

        setSim(localSim);
        setScene(localScene);
        setControl(localControl);
        setRecorder(localRecorder);
        setBoot({ phase: 'ready', message: 'ready' });
      } catch (err) {
        const msg = (err as Error).message;
        console.error(err);
        setBoot({ phase: 'error', message: `error: ${msg}` });
        pushToast('error', msg);
      }
    })();

    return () => {
      cancelled = true;
      localRecorder?.dispose();
      localControl?.dispose();
      localScene?.stop();
      localSim?.dispose();
      setSim(null);
      setScene(null);
      setControl(null);
      setRecorder(null);
      bootedRef.current = false;
    };
  }, [pushToast]);

  const togglePaused = useCallback(() => {
    if (!scene) return;
    scene.togglePaused();
    setPaused(scene.paused);
  }, [scene]);

  const toggleFollow = useCallback(() => {
    if (!scene) return;
    scene.toggleFollow();
    setFollowEnabled(scene.followEnabled);
  }, [scene]);

  // Keyboard shortcuts. Skip when the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case ' ':
        case 'p': e.preventDefault(); togglePaused(); break;
        case 'f': toggleFollow(); break;
        case 's': control?.stand({ pinRoot: true }); pushToast('info', 'stand (pinned)'); break;
        case 'x': control?.goLimp(); pushToast('info', 'released'); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePaused, toggleFollow, control, pushToast]);

  return (
    <div className="app">
      <canvas ref={canvasRef} className="viewport" />
      <div className="hud">
        <div className="status">{boot.message}</div>
        {sim && (
          <div className="info">
            geoms: {sim.ngeom} · bodies: {sim.nbody} · actuators: {sim.nu}
            {paused && <span className="paused"> · PAUSED</span>}
          </div>
        )}
        {(boot.phase === 'wasm' || boot.phase === 'fetch') && (
          <div className="boot-progress">
            <div className="boot-bar" />
            <div className="boot-hint">first load downloads ~9 MB of WASM</div>
          </div>
        )}
        {sim && (
          <div className="hud-help">
            shortcuts: <kbd>P</kbd>/<kbd>Space</kbd> pause · <kbd>F</kbd> follow · <kbd>S</kbd> stand · <kbd>X</kbd> release · <kbd>Cmd</kbd>+<kbd>K</kbd> chat
          </div>
        )}
      </div>
      {sim && (
        <ControlsPanel
          sim={sim}
          control={control}
          recorder={recorder}
          paused={paused}
          onTogglePaused={togglePaused}
          followEnabled={followEnabled}
          onToggleFollow={toggleFollow}
          onToast={pushToast}
        />
      )}
      {control && <ChatPanel control={control} onToast={pushToast} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
