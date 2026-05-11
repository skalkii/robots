import type { MujocoSim } from '../sim/MujocoSim';

export type Side = 'left' | 'right';
export type WalkDirection = 'forward' | 'backward' | 'left' | 'right';

interface LocomotionState {
  /** Current world-frame xy of the torso. */
  pos: [number, number];
  /** Current yaw about world Z (radians). */
  yaw: number;
  /** Pending walk command, if any. */
  walk: { dir: WalkDirection; remaining: number; speed: number } | null;
  /** Pending turn command, if any. signedRate in rad/s. */
  turn: { remaining: number; signedRate: number } | null;
}

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
  private locomotion: LocomotionState | null = null;

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

  /**
   * Kinematic walk along a robot-relative direction for `distanceMeters`.
   *
   * The free root joint is written every step rather than integrated by
   * physics — this is the explicit "cheat" called out in the project
   * context doc. Limb PD targets continue to act so the humanoid keeps
   * a coherent standing pose while it glides; gait synthesis is not yet
   * implemented. Calling `stand()` first is recommended.
   *
   * Speed defaults to 1.0 m/s. Setting `pinRoot` is incompatible with
   * locomotion (locomotion writes the root every step anyway), so
   * activating walk implicitly disables the pin.
   */
  walk(direction: WalkDirection, distanceMeters: number, speed = 1.0) {
    if (distanceMeters <= 0 || speed <= 0) return;
    const loco = this.ensureLocomotion();
    loco.walk = { dir: direction, remaining: distanceMeters, speed };
  }

  /**
   * Kinematic in-place yaw rotation. Positive degrees = counter-clockwise
   * when viewed from above (+Z up), i.e. "turn left". Default angular
   * rate is 90°/s.
   */
  turn(degrees: number, rateDegPerSec = 90) {
    if (degrees === 0 || rateDegPerSec <= 0) return;
    const loco = this.ensureLocomotion();
    const rad = degToRad(degrees);
    loco.turn = {
      remaining: Math.abs(rad),
      signedRate: Math.sign(rad) * degToRad(rateDegPerSec),
    };
  }

  /** Cancel any in-progress walk/turn. Limb PD targets stay engaged. */
  stop() {
    this.locomotion = null;
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
    this.locomotion = null;
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
    if (this.locomotion) this.advanceLocomotion();
    else if (this.pinRoot) this.applyRootPin();
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

  private ensureLocomotion(): LocomotionState {
    const root = this.sim.rootFreeJoint;
    if (!root) {
      throw new UnsupportedControlError(
        'locomotion',
        'the current model has no free root joint, so kinematic locomotion is not available',
      );
    }
    // Locomotion takes over root writes; root pin would clobber its updates.
    this.pinRoot = false;
    if (this.locomotion) return this.locomotion;

    const init = this.sim.initialQpos;
    const x0 = init[root.qposAdr + 0];
    const y0 = init[root.qposAdr + 1];
    const qw = init[root.qposAdr + 3];
    const qx = init[root.qposAdr + 4];
    const qy = init[root.qposAdr + 5];
    const qz = init[root.qposAdr + 6];
    const yaw0 = quatToYaw(qw, qx, qy, qz);
    this.locomotion = { pos: [x0, y0], yaw: yaw0, walk: null, turn: null };
    return this.locomotion;
  }

  private advanceLocomotion() {
    const root = this.sim.rootFreeJoint;
    const loco = this.locomotion;
    if (!root || !loco) return;
    const dt = this.sim.dt;

    if (loco.turn) {
      const want = loco.turn.signedRate * dt;
      const cap = Math.min(Math.abs(want), loco.turn.remaining) * Math.sign(want);
      loco.yaw += cap;
      loco.turn.remaining -= Math.abs(cap);
      if (loco.turn.remaining <= 1e-6) loco.turn = null;
    }

    if (loco.walk) {
      const want = loco.walk.speed * dt;
      const cap = Math.min(want, loco.walk.remaining);
      const [dx, dy] = worldDirFromLocal(loco.walk.dir, loco.yaw);
      loco.pos[0] += dx * cap;
      loco.pos[1] += dy * cap;
      loco.walk.remaining -= cap;
      if (loco.walk.remaining <= 1e-6) loco.walk = null;
    }

    // Write root qpos every step so physics can't drift it.
    const qpos = this.sim.qpos;
    const qvel = this.sim.qvel;
    const init = this.sim.initialQpos;
    qpos[root.qposAdr + 0] = loco.pos[0];
    qpos[root.qposAdr + 1] = loco.pos[1];
    qpos[root.qposAdr + 2] = init[root.qposAdr + 2];
    const half = loco.yaw / 2;
    qpos[root.qposAdr + 3] = Math.cos(half);
    qpos[root.qposAdr + 4] = 0;
    qpos[root.qposAdr + 5] = 0;
    qpos[root.qposAdr + 6] = Math.sin(half);
    for (let i = 0; i < 6; i++) qvel[root.dofAdr + i] = 0;

    if (!loco.walk && !loco.turn) {
      // Stay in place at the final commanded pose until the user issues
      // another locomotion command or releaseAll().
    }
  }
}

function quatToYaw(w: number, x: number, y: number, z: number): number {
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

function worldDirFromLocal(dir: WalkDirection, yaw: number): [number, number] {
  // Robot local axes: +X forward, +Y left (right-handed, Z up).
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  switch (dir) {
    case 'forward':  return [cy, sy];
    case 'backward': return [-cy, -sy];
    case 'left':     return [-sy, cy];
    case 'right':    return [sy, -cy];
  }
}

function degToRad(d: number) { return (d * Math.PI) / 180; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
