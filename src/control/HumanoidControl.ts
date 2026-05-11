import type { MujocoSim } from '../sim/MujocoSim';
import { CONTROL } from '../config';

export type Side = 'left' | 'right';
export type WalkDirection = 'forward' | 'backward' | 'left' | 'right';

/** Optional callback so callers can teach the locomotion cheat about
 *  non-flat terrain. The function receives the robot's world XY position and
 *  returns the ground height at that location (Z in MuJoCo's frame), or null
 *  if unknown (in which case the controller falls back to the initial qpos
 *  Z value, i.e. assumes a flat floor at the original height). */
export type GroundHeightProvider = (x: number, y: number) => number | null;

interface LocomotionState {
  pos: [number, number];
  yaw: number;
  walk: { dir: WalkDirection; remaining: number; speed: number } | null;
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
  /** Inverse of the actuator's gear so we can divide once per tick. */
  invGear: number;
  /** Actuator-declared ctrl range pulled from the MJCF (or symmetric [-1, 1]
   *  default). Output is clamped to this rather than a global [-1, 1]. */
  ctrlMin: number;
  ctrlMax: number;
  target: number;
  /** Proportional gain in N·m / rad (already in physical units, gear-aware). */
  kp: number;
  /** Derivative gain in N·m·s / rad. */
  kd: number;
}

export interface StandOptions {
  pinRoot?: boolean;
  /** Override the base proportional gain (Nm/rad). Per-joint gear is applied
   *  on top so heavier joints still get their share of effort. */
  kp?: number;
  kd?: number;
}

export class HumanoidControl {
  private sim: MujocoSim;
  private targets = new Map<string, PDTarget>();
  private unregister: (() => void) | null = null;
  private pinRoot = false;
  private locomotion: LocomotionState | null = null;
  private groundHeightProvider: GroundHeightProvider | null = null;

  constructor(sim: MujocoSim) {
    this.sim = sim;
    this.unregister = sim.setStepHook(() => this.tick());
  }

  dispose() {
    this.unregister?.();
    this.unregister = null;
    this.goLimp();
  }

  // ──────────────────────────────────────────────────────────────────────
  // Per-limb commands
  // ──────────────────────────────────────────────────────────────────────

  raiseArm(side: Side, angleDeg: number) {
    const a = degToRad(angleDeg);
    this.setTarget(`shoulder1_${side}`, `shoulder1_${side}`, a, CONTROL.pd.armKp, CONTROL.pd.armKd);
    this.setTarget(`shoulder2_${side}`, `shoulder2_${side}`, a, CONTROL.pd.armKp, CONTROL.pd.armKd);
  }

  lowerArm(side: Side) { this.raiseArm(side, 0); }

  bendElbow(side: Side, angleDeg: number) {
    this.setTarget(`elbow_${side}`, `elbow_${side}`, degToRad(angleDeg), CONTROL.pd.elbowKp, CONTROL.pd.elbowKd);
  }

  /**
   * Drive every actuated joint toward its default angle. Existing per-limb
   * targets are cleared first so a stale `raiseArm` doesn't fight stand.
   *
   * For real-world standing, also enable `pinRoot` to kinematically clamp
   * the torso (the floating-base humanoid is statically unstable and will
   * eventually topple under integration noise even with perfect PD).
   */
  stand(opts: StandOptions = {}) {
    const kp = opts.kp ?? CONTROL.pd.standKp;
    const kd = opts.kd ?? CONTROL.pd.standKd;
    this.clearTargets();
    for (const a of this.sim.actuators()) {
      this.setTarget(a.name, a.name, 0, kp, kd);
    }
    this.pinRoot = !!opts.pinRoot;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Locomotion (kinematic root translation/rotation)
  // ──────────────────────────────────────────────────────────────────────

  walk(direction: WalkDirection, distanceMeters: number, speed: number = CONTROL.walk.defaultSpeedMps) {
    if (distanceMeters < CONTROL.walk.minDistanceM || speed <= 0) return;
    // Without limb PD, the body glides while limbs ragdoll — implicitly stand
    // so the visual stays coherent.
    if (this.targets.size === 0) this.stand();
    const loco = this.ensureLocomotion();
    loco.walk = { dir: direction, remaining: distanceMeters, speed };
  }

  turn(degrees: number, rateDegPerSec: number = CONTROL.turn.defaultRateDegPerSec) {
    if (degrees === 0 || rateDegPerSec <= 0) return;
    if (this.targets.size === 0) this.stand();
    const loco = this.ensureLocomotion();
    const rad = degToRad(degrees);
    loco.turn = {
      remaining: Math.abs(rad),
      signedRate: Math.sign(rad) * degToRad(rateDegPerSec),
    };
  }

  /** Cancel any in-progress walk/turn. PD targets and root pin stay. */
  cancelMotion() { this.locomotion = null; }

  // ──────────────────────────────────────────────────────────────────────
  // Atomic state operations
  // ──────────────────────────────────────────────────────────────────────

  /** Clear PD targets only. Locomotion and root pin keep running. */
  clearTargets() {
    for (const t of this.targets.values()) this.sim.setCtrl(t.actuatorIdx, 0);
    this.targets.clear();
  }

  /** Release a single joint's PD target. */
  release(joint: string) {
    if (this.targets.delete(joint)) {
      const idx = this.sim.findActuator(joint);
      if (idx !== null) this.sim.setCtrl(idx, 0);
    }
  }

  unpinRoot() { this.pinRoot = false; }

  /** Install a ground-height callback so kinematic locomotion can follow
   *  uneven terrain. Pass `null` to revert to flat-floor behavior. */
  setGroundHeightProvider(fn: GroundHeightProvider | null) {
    this.groundHeightProvider = fn;
  }

  /** Drop everything: PD targets, root pin, locomotion. The robot goes limp. */
  goLimp() {
    this.clearTargets();
    this.pinRoot = false;
    this.locomotion = null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Unsupported on the stock model — kept on the surface so callers (and
  // LLM agents) get a typed failure rather than a missing method.
  // ──────────────────────────────────────────────────────────────────────

  turnHead(...args: [yawDeg: number, pitchDeg: number]): never {
    void args;
    throw new UnsupportedControlError(
      'turnHead',
      'the current humanoid model has no head joint (head is rigidly attached to the torso)',
    );
  }

  lookAt(...args: [target: [number, number, number]]): never {
    void args;
    throw new UnsupportedControlError(
      'lookAt',
      'requires a head joint, which the current humanoid model lacks',
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  private setTarget(jointName: string, actuatorName: string, target: number, kp: number, kd: number) {
    const j = this.sim.findJoint(jointName);
    const a = this.sim.findActuator(actuatorName);
    if (!j || a === null) {
      throw new UnsupportedControlError(
        'setTarget',
        `joint "${jointName}" or actuator "${actuatorName}" not found in model`,
      );
    }
    const gear = this.sim.gear[a] || 1;
    const [ctrlMin, ctrlMax] = this.sim.ctrlRangeOf(a);
    this.targets.set(jointName, {
      jointName,
      actuatorName,
      qposAdr: j.qposAdr,
      dofAdr: j.dofAdr,
      actuatorIdx: a,
      invGear: 1 / gear,
      ctrlMin,
      ctrlMax,
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
      // PD output in physical torque units; convert to normalized ctrl via
      // 1/gear so heavier-geared joints don't blow past their ctrl limits.
      const u = clamp((t.kp * (t.target - q) - t.kd * v) * t.invGear, t.ctrlMin, t.ctrlMax);
      this.sim.setCtrl(t.actuatorIdx, u);
    }
  }

  private applyRootPin() {
    const root = this.sim.rootFreeJoint;
    if (!root) return;
    const qpos = this.sim.qpos;
    const qvel = this.sim.qvel;
    const init = this.sim.initialQpos;
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
    this.pinRoot = false;
    if (this.locomotion) return this.locomotion;

    const init = this.sim.initialQpos;
    const x0 = init[root.qposAdr + 0];
    const y0 = init[root.qposAdr + 1];
    const qw = init[root.qposAdr + 3];
    const qx = init[root.qposAdr + 4];
    const qy = init[root.qposAdr + 5];
    const qz = init[root.qposAdr + 6];
    this.locomotion = { pos: [x0, y0], yaw: quatToYaw(qw, qx, qy, qz), walk: null, turn: null };
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

    const qpos = this.sim.qpos;
    const qvel = this.sim.qvel;
    const init = this.sim.initialQpos;
    qpos[root.qposAdr + 0] = loco.pos[0];
    qpos[root.qposAdr + 1] = loco.pos[1];
    // Default: keep the torso at its initial height (assumes flat floor at
    // whatever z the model spawned over). With a ground-height provider,
    // float the torso so it stays at the same standing offset above local
    // terrain.
    const initialZ = init[root.qposAdr + 2];
    if (this.groundHeightProvider) {
      const ground = this.groundHeightProvider(loco.pos[0], loco.pos[1]);
      qpos[root.qposAdr + 2] = ground != null ? ground + initialZ : initialZ;
    } else {
      qpos[root.qposAdr + 2] = initialZ;
    }
    const half = loco.yaw / 2;
    qpos[root.qposAdr + 3] = Math.cos(half);
    qpos[root.qposAdr + 4] = 0;
    qpos[root.qposAdr + 5] = 0;
    qpos[root.qposAdr + 6] = Math.sin(half);
    for (let i = 0; i < 6; i++) qvel[root.dofAdr + i] = 0;
  }
}

export function quatToYaw(w: number, x: number, y: number, z: number): number {
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

export function worldDirFromLocal(dir: WalkDirection, yaw: number): [number, number] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  switch (dir) {
    case 'forward':  return [cy, sy];
    case 'backward': return [-cy, -sy];
    case 'left':     return [-sy, cy];
    case 'right':    return [sy, -cy];
  }
}

export function degToRad(d: number) { return (d * Math.PI) / 180; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
