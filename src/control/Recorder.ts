import type { MujocoSim } from '../sim/MujocoSim';
import type { HumanoidControl } from './HumanoidControl';

export interface Trajectory {
  id: string;
  /** Sim timestep used while recording. */
  dt: number;
  /** Length of one frame (== sim.nq). */
  nq: number;
  /** Flat Float32Array of N frames of qpos in row-major order. */
  frames: Float32Array;
}

export interface SerializedTrajectory {
  id: string;
  dt: number;
  nq: number;
  /** base64-encoded little-endian Float32Array bytes. */
  frames: string;
  /** Trajectory frame count. Stored explicitly for sanity checks. */
  frameCount: number;
}

export type RecorderState = 'idle' | 'recording' | 'playing';

interface Listeners {
  onStateChange?: (state: RecorderState) => void;
  onTrajectoryReady?: (t: Trajectory) => void;
}

export interface RecorderOptions extends Listeners {
  /** Hard frame cap. Overridden by `captureDurationSec` when both are set. */
  maxFrames?: number;
  /** Convenience: cap the buffer to this many seconds of sim time. Computed
   *  against `sim.dt` at construction. */
  captureDurationSec?: number;
  /** Optional `HumanoidControl` handle. When provided, starting a playback
   *  also clears the controller's PD targets and locomotion so the
   *  kinematic qpos writes aren't fighting an active PD loop. */
  control?: HumanoidControl;
}

/**
 * Captures and replays `data.qpos` trajectories from a `MujocoSim`. One
 * mode at a time (recording or playing). The buffer caps at `maxFrames`
 * to bound memory; older frames roll off the head while recording.
 */
export class Recorder {
  private sim: MujocoSim;
  private control: HumanoidControl | undefined;
  private listeners: Listeners;
  private maxFrames: number;
  private state: RecorderState = 'idle';
  private buffer: number[][] = [];
  private playHead = 0;
  private activeTrajectory: Trajectory | null = null;
  private unregister: (() => void) | null = null;

  constructor(sim: MujocoSim, opts: RecorderOptions = {}) {
    this.sim = sim;
    this.control = opts.control;
    this.maxFrames = opts.captureDurationSec != null
      ? Math.max(1, Math.ceil(opts.captureDurationSec / Math.max(sim.dt, 1e-6)))
      : opts.maxFrames ?? 6000; // 30 s at 5 ms timestep
    this.listeners = { onStateChange: opts.onStateChange, onTrajectoryReady: opts.onTrajectoryReady };
  }

  /** Adjust the capture window at runtime. Drops existing buffered frames
   *  beyond the new cap. */
  setCaptureDuration(seconds: number) {
    this.maxFrames = Math.max(1, Math.ceil(seconds / Math.max(this.sim.dt, 1e-6)));
    while (this.buffer.length > this.maxFrames) this.buffer.shift();
  }

  getState(): RecorderState { return this.state; }
  getTrajectory(): Trajectory | null { return this.activeTrajectory; }
  getRecordedFrameCount(): number { return this.state === 'recording' ? this.buffer.length : 0; }

  dispose() {
    this.detach();
    this.buffer = [];
    this.activeTrajectory = null;
  }

  startRecording() {
    if (this.state === 'recording') return;
    this.detach();
    this.buffer = [];
    this.state = 'recording';
    this.unregister = this.sim.setStepHook(() => this.captureFrame());
    this.emitState();
  }

  stop() {
    if (this.state === 'idle') return;
    const wasRecording = this.state === 'recording';
    this.detach();
    if (wasRecording && this.buffer.length > 0) {
      this.activeTrajectory = this.snapshotTrajectory();
      this.listeners.onTrajectoryReady?.(this.activeTrajectory);
    }
    this.state = 'idle';
    this.emitState();
  }

  play(t: Trajectory) {
    if (this.state !== 'idle') this.stop();
    if (t.nq !== this.sim.nq) {
      throw new Error(`Trajectory nq=${t.nq} does not match sim nq=${this.sim.nq}`);
    }
    // Quiet the PD loop and any in-progress locomotion so the kinematic
    // playback writes aren't being fought every step.
    this.control?.clearTargets();
    this.control?.cancelMotion();
    this.activeTrajectory = t;
    this.playHead = 0;
    this.state = 'playing';
    this.unregister = this.sim.setStepHook(() => this.advancePlayback());
    this.emitState();
  }

  private captureFrame() {
    const qpos = this.sim.qpos;
    const frame: number[] = new Array(qpos.length);
    for (let i = 0; i < qpos.length; i++) frame[i] = qpos[i];
    this.buffer.push(frame);
    if (this.buffer.length > this.maxFrames) this.buffer.shift();
  }

  private advancePlayback() {
    const t = this.activeTrajectory;
    if (!t) { this.stop(); return; }
    const frameCount = t.frames.length / t.nq;
    if (this.playHead >= frameCount) { this.stop(); return; }
    const qpos = this.sim.qpos;
    const base = this.playHead * t.nq;
    for (let i = 0; i < t.nq; i++) qpos[i] = t.frames[base + i];
    this.playHead++;
  }

  private snapshotTrajectory(): Trajectory {
    const nq = this.sim.nq;
    const frames = new Float32Array(this.buffer.length * nq);
    for (let i = 0; i < this.buffer.length; i++) {
      const f = this.buffer[i];
      for (let j = 0; j < nq; j++) frames[i * nq + j] = f[j];
    }
    return {
      id: `traj-${Date.now().toString(36)}`,
      dt: this.sim.dt,
      nq,
      frames,
    };
  }

  private detach() {
    this.unregister?.();
    this.unregister = null;
    this.playHead = 0;
  }

  private emitState() {
    this.listeners.onStateChange?.(this.state);
  }
}

export function serializeTrajectory(t: Trajectory): SerializedTrajectory {
  const bytes = new Uint8Array(t.frames.buffer, t.frames.byteOffset, t.frames.byteLength);
  return {
    id: t.id,
    dt: t.dt,
    nq: t.nq,
    frames: bytesToBase64(bytes),
    frameCount: t.frames.length / t.nq,
  };
}

export function deserializeTrajectory(s: SerializedTrajectory): Trajectory {
  const bytes = base64ToBytes(s.frames);
  const frames = new Float32Array(s.frameCount * s.nq);
  new Uint8Array(frames.buffer).set(bytes);
  return { id: s.id, dt: s.dt, nq: s.nq, frames };
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
