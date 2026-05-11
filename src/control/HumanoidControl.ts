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
export interface StandOptions {
  /** If true, freezes the torso root in its default position/orientation each
   *  step (kinematic cheat — robot won't fall but also won't interact with
   *  external forces on its base). Default: false. */
  pinRoot?: boolean;
  /** Proportional gain for the joint-angle PD. */
  kp?: number;
  /** Derivative gain. */
  kd?: number;
}

export class HumanoidControl {
  private sim: MujocoSim;
  private targets = new Map<string, PDTarget>();
  private unregister: (() => void) | null = null;
  private pinRoot = false;

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

  /**
   * Drive every actuated joint toward its default angle so the humanoid holds
   * its initial standing pose.
   *
   * In humanoid.xml each actuator name equals its driven joint name, and the
   * model's default qpos for those hinges is 0, so the PD target is 0 across
   * the board. Gains are stiffer than the per-limb commands above.
   *
   * The model is statically unstable: even with all joints pinned to neutral
   * the floating-base humanoid will eventually topple under integration
   * noise. For a reliable "just stand there" demo, pass `{ pinRoot: true }`
   * to also clamp the torso's free joint in place each step (kinematic
   * cheat per the project docs).
   */
  stand(opts: StandOptions = {}) {
    const kp = opts.kp ?? 14;
    const kd = opts.kd ?? 0.9;
    for (const a of this.sim.actuators()) {
      this.setTarget(a.name, a.name, 0, kp, kd);
    }
    this.pinRoot = !!opts.pinRoot;
  }

  /** Turn off the root pin set by `stand({ pinRoot: true })`. PD targets stay
   *  active — call `releaseAll()` to also clear those. */
  unpinRoot() {
    this.pinRoot = false;
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
    this.pinRoot = false;
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
    if (this.pinRoot) this.applyRootPin();
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

  private applyRootPin() {
    const root = this.sim.rootFreeJoint;
    if (!root) return;
    const qpos = this.sim.qpos;
    const qvel = this.sim.qvel;
    const init = this.sim.initialQpos;
    // Free joint: 7 qpos slots (3 pos + 4 quat) and 6 qvel slots (3 lin + 3 ang).
    for (let i = 0; i < 7; i++) qpos[root.qposAdr + i] = init[root.qposAdr + i];
    for (let i = 0; i < 6; i++) qvel[root.dofAdr + i] = 0;
  }
}

function degToRad(d: number) { return (d * Math.PI) / 180; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
