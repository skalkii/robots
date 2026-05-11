import { describe, expect, it } from 'vitest';
import {
  Recorder,
  serializeTrajectory,
  deserializeTrajectory,
  type Trajectory,
} from './Recorder';
import type { MujocoSim } from '../sim/MujocoSim';

interface FakeSim {
  qpos: Float64Array;
  nq: number;
  dt: number;
  setStepHook(fn: () => void): () => void;
  step(): void;
  hookCount: number;
}

function makeFakeSim(nq = 4, dt = 0.005): FakeSim {
  const hooks = new Set<() => void>();
  const qpos = new Float64Array(nq);
  return {
    qpos, nq, dt,
    setStepHook(fn) {
      hooks.add(fn);
      return () => hooks.delete(fn);
    },
    step() { for (const h of hooks) h(); },
    get hookCount() { return hooks.size; },
  };
}

function castSim(s: FakeSim): MujocoSim {
  return s as unknown as MujocoSim;
}

describe('Recorder', () => {
  it('captures qpos snapshots in order during recording', () => {
    const sim = makeFakeSim(3);
    const recorder = new Recorder(castSim(sim));
    recorder.startRecording();
    sim.qpos.set([1, 2, 3]);
    sim.step();
    sim.qpos.set([4, 5, 6]);
    sim.step();
    recorder.stop();

    const t = recorder.getTrajectory();
    expect(t).not.toBeNull();
    expect(t!.nq).toBe(3);
    expect(Array.from(t!.frames)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t!.dt).toBe(sim.dt);
  });

  it('caps captured frames at maxFrames (sliding window)', () => {
    const sim = makeFakeSim(1);
    const recorder = new Recorder(castSim(sim), { maxFrames: 3 });
    recorder.startRecording();
    for (let i = 1; i <= 5; i++) {
      sim.qpos[0] = i;
      sim.step();
    }
    recorder.stop();
    expect(Array.from(recorder.getTrajectory()!.frames)).toEqual([3, 4, 5]);
  });

  it('writes qpos from the trajectory during playback and auto-stops', () => {
    const sim = makeFakeSim(2);
    const recorder = new Recorder(castSim(sim));
    const traj: Trajectory = {
      id: 'fixture',
      dt: sim.dt,
      nq: 2,
      frames: new Float32Array([10, 20, 30, 40]),
    };
    recorder.play(traj);
    sim.step();
    expect(Array.from(sim.qpos)).toEqual([10, 20]);
    sim.step();
    expect(Array.from(sim.qpos)).toEqual([30, 40]);
    // Third step exhausts the buffer; recorder auto-stops.
    sim.step();
    expect(recorder.getState()).toBe('idle');
  });

  it('refuses to play a trajectory with mismatched nq', () => {
    const sim = makeFakeSim(2);
    const recorder = new Recorder(castSim(sim));
    expect(() => recorder.play({ id: 'x', dt: 0.005, nq: 3, frames: new Float32Array(3) }))
      .toThrow(/nq/);
  });

  it('detaches hooks on stop and on dispose', () => {
    const sim = makeFakeSim(1);
    const recorder = new Recorder(castSim(sim));
    recorder.startRecording();
    expect(sim.hookCount).toBe(1);
    recorder.stop();
    expect(sim.hookCount).toBe(0);

    recorder.startRecording();
    recorder.dispose();
    expect(sim.hookCount).toBe(0);
  });

  it('starting a new mode replaces the previous one', () => {
    const sim = makeFakeSim(1);
    const recorder = new Recorder(castSim(sim));
    recorder.startRecording();
    sim.qpos[0] = 7;
    sim.step();
    const t = { id: 'x', dt: 0.005, nq: 1, frames: new Float32Array([99]) };
    recorder.play(t);
    expect(sim.hookCount).toBe(1);
    sim.step();
    expect(sim.qpos[0]).toBe(99);
  });
});

describe('Trajectory serialization', () => {
  it('round-trips through base64 without loss', () => {
    const original: Trajectory = {
      id: 'traj-test',
      dt: 0.005,
      nq: 3,
      frames: new Float32Array([1.5, -2.25, 3.75, 4, 5, 6]),
    };
    const serialized = serializeTrajectory(original);
    const restored = deserializeTrajectory(serialized);
    expect(restored.id).toBe(original.id);
    expect(restored.dt).toBe(original.dt);
    expect(restored.nq).toBe(original.nq);
    expect(Array.from(restored.frames)).toEqual(Array.from(original.frames));
  });

  it('preserves frameCount in the serialized envelope', () => {
    const t: Trajectory = { id: 'x', dt: 0.005, nq: 2, frames: new Float32Array([1, 2, 3, 4, 5, 6]) };
    const s = serializeTrajectory(t);
    expect(s.frameCount).toBe(3);
  });
});
