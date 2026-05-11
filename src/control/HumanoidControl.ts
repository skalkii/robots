import type { MujocoSim } from '../sim/MujocoSim';

export type Side = 'left' | 'right';

export class UnsupportedControlError extends Error {
  constructor(method: string, reason: string) {
    super(`${method}: ${reason}`);
    this.name = 'UnsupportedControlError';
  }
}

interface PDTarget {
  jointName: string;
  actuatorName: string;
  qposAdr: number;
  dofAdr: number;
  actuatorIdx: number;
  target: number;
  kp: number;
  kd: number;
}

/**
 * High-level kinematic control for the canonical DeepMind humanoid model.
 *
 * Every joint in humanoid.xml is driven by a torque-mode <motor>, so this
 * class layers a per-joint PD controller on top. Each physics step reads the
 * current joint angle/velocity, computes u = kp*(target - q) - kd*v, clamps
 * to the actuator's ctrl range, and writes data.ctrl[i]. Targets persist
 * until release(joint) or releaseAll() is called.
 */
export class HumanoidControl {
  private sim: MujocoSim;
  private targets = new Map<string, PDTarget>();
  private unregister: (() => void) | null = null;

  constructor(sim: MujocoSim) {
    this.sim = sim;
    this.unregister = sim.setStepHook(() => this.tick());
  }

  dispose() {
    this.unregister?.();
    this.unregister = null;
    this.releaseAll();
  }

  raiseArm(side: Side, angleDeg: number) {
    const a = degToRad(angleDeg);
    this.setTarget(`shoulder1_${side}`, `shoulder1_${side}`, a, 8, 0.6);
    this.setTarget(`shoulder2_${side}`, `shoulder2_${side}`, a, 8, 0.6);
  }

  lowerArm(side: Side) {
    this.raiseArm(side, 0);
  }

  bendElbow(side: Side, angleDeg: number) {
    this.setTarget(`elbow_${side}`, `elbow_${side}`, degToRad(angleDeg), 6, 0.4);
  }

  release(joint: string) {
    if (this.targets.delete(joint)) {
      const idx = this.sim.findActuator(joint);
      if (idx !== null) this.sim.setCtrl(idx, 0);
    }
  }

  releaseAll() {
    for (const t of this.targets.values()) this.sim.setCtrl(t.actuatorIdx, 0);
    this.targets.clear();
  }

  turnHead(_yawDeg: number, _pitchDeg: number): never {
    throw new UnsupportedControlError(
      'turnHead',
      'the current humanoid model has no head joint (head is rigidly attached to the torso)',
    );
  }

  lookAt(_target: [number, number, number]): never {
    throw new UnsupportedControlError(
      'lookAt',
      'requires a head joint, which the current humanoid model lacks',
    );
  }

  private setTarget(jointName: string, actuatorName: string, target: number, kp: number, kd: number) {
    const j = this.sim.findJoint(jointName);
    const a = this.sim.findActuator(actuatorName);
    if (!j || a === null) {
      throw new UnsupportedControlError(
        'setTarget',
        `joint "${jointName}" or actuator "${actuatorName}" not found in model`,
      );
    }
    this.targets.set(jointName, {
      jointName,
      actuatorName,
      qposAdr: j.qposAdr,
      dofAdr: j.dofAdr,
      actuatorIdx: a,
      target,
      kp,
      kd,
    });
  }

  private tick() {
    if (this.targets.size === 0) return;
    const qpos = this.sim.qpos;
    const qvel = this.sim.qvel;
    for (const t of this.targets.values()) {
      const q = qpos[t.qposAdr];
      const v = qvel[t.dofAdr];
      const u = clamp(t.kp * (t.target - q) - t.kd * v, -1, 1);
      this.sim.setCtrl(t.actuatorIdx, u);
    }
  }
}

function degToRad(d: number) { return (d * Math.PI) / 180; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
