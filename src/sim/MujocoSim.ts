import loadMujoco from '@mujoco/mujoco';
import type { MainModule, MjModel, MjData } from '@mujoco/mujoco';
import { GeomType, type GeomDescriptor, type GeomTypeValue } from './types';

/**
 * Minimal typed views over Embind-wrapped MuJoCo objects.
 *
 * The generated `.d.ts` types most numeric arrays as `any` because Embind
 * cannot describe their concrete typed-array shape. Casting at every call
 * site bleeds `unknown` through the codebase. Instead we centralize the
 * unsafety here and present strongly-typed accessors to callers.
 */
interface TypedMjModel {
  ngeom: number; nbody: number; njnt: number; nq: number; nv: number; nu: number;
  opt: { timestep: number };
  geom_type: Int32Array; geom_size: Float64Array; geom_rgba: Float32Array; geom_bodyid: Int32Array;
  jnt_qposadr: Int32Array; jnt_dofadr: Int32Array; jnt_type: Int32Array;
  actuator_ctrllimited: Uint8Array; actuator_ctrlrange: Float64Array; actuator_gear: Float64Array;
  jnt(i: number): { name: string; delete(): void };
  actuator(i: number): { name: string; delete(): void };
  delete(): void;
}
interface TypedMjData {
  qpos: Float64Array; qvel: Float64Array; ctrl: Float64Array;
  geom_xpos: Float64Array; geom_xmat: Float64Array;
  delete(): void;
}

function asTypedModel(m: MjModel): TypedMjModel { return m as unknown as TypedMjModel; }
function asTypedData(d: MjData): TypedMjData { return d as unknown as TypedMjData; }

export interface GeomTransform {
  position: [number, number, number];
  matrix: [number, number, number, number, number, number, number, number, number];
}

export interface ActuatorInfo {
  index: number;
  name: string;
  range: [number, number];
  hasExplicitRange: boolean;
  /** Six-vector gear from `actuator_gear` (only the first scalar matters for
   *  pure motor actuators on hinge joints). Used by controllers to scale PD
   *  gains so heavier joints don't twitch and lighter joints don't crawl. */
  gearScalar: number;
}

export interface JointAddr {
  qposAdr: number;
  dofAdr: number;
  /** mjtJoint enum: 0 free, 1 ball, 2 slide, 3 hinge. */
  type: number;
}

export type StepHook = () => void;

export class SimDisposedError extends Error {
  constructor() { super('MujocoSim has been disposed'); this.name = 'SimDisposedError'; }
}

export class MujocoSim {
  private mujoco: MainModule | null = null;
  private model: TypedMjModel | null = null;
  private data: TypedMjData | null = null;
  /** Holds the un-typed handles separately so we can call the API methods
   *  (`mj_step`, etc.) that take them by reference without re-casting. */
  private rawModel: MjModel | null = null;
  private rawData: MjData | null = null;

  ngeom = 0;
  nbody = 0;
  njnt = 0;
  nq = 0;
  nv = 0;

  geoms: GeomDescriptor[] = [];

  initialQpos: Float64Array = new Float64Array();
  rootFreeJoint: { qposAdr: number; dofAdr: number } | null = null;

  private jointAddr = new Map<string, JointAddr>();
  private actuatorIdx = new Map<string, number>();
  private actuatorGear = new Float64Array(0);
  private stepHooks: StepHook[] = [];
  private disposed = false;

  static async load(xmlText: string): Promise<MujocoSim> {
    const sim = new MujocoSim();
    await sim.boot(xmlText);
    return sim;
  }

  private async boot(xmlText: string) {
    this.mujoco = await loadMujoco();

    const fs = (this.mujoco as unknown as {
      FS: { mkdir: (p: string) => void; writeFile: (p: string, d: string) => void };
    }).FS;
    try { fs.mkdir('/working'); } catch { /* exists */ }
    fs.writeFile('/working/humanoid.xml', xmlText);

    this.rawModel = this.mujoco.MjModel.from_xml_string(xmlText);
    this.rawData = new this.mujoco.MjData(this.rawModel);
    this.model = asTypedModel(this.rawModel);
    this.data = asTypedData(this.rawData);

    const m = this.model;
    this.ngeom = m.ngeom; this.nbody = m.nbody; this.njnt = m.njnt;
    this.nq = m.nq; this.nv = m.nv;

    this.cacheGeomDescriptors();
    this.cacheNameLookups();
    this.detectRootFreeJoint();
    this.mujoco.mj_forward(this.rawModel, this.rawData);
    this.initialQpos = new Float64Array(this.qpos);
  }

  private detectRootFreeJoint() {
    if (!this.model || this.njnt === 0) return;
    if (this.model.jnt_type[0] === 0) {
      this.rootFreeJoint = {
        qposAdr: this.model.jnt_qposadr[0],
        dofAdr: this.model.jnt_dofadr[0],
      };
    }
  }

  private cacheNameLookups() {
    const m = this.model;
    if (!m) return;
    for (let i = 0; i < this.njnt; i++) {
      const acc = m.jnt(i);
      if (acc.name) {
        this.jointAddr.set(acc.name, {
          qposAdr: m.jnt_qposadr[i],
          dofAdr: m.jnt_dofadr[i],
          type: m.jnt_type[i],
        });
      }
      acc.delete();
    }
    const gear = new Float64Array(this.nu);
    for (let i = 0; i < this.nu; i++) {
      const acc = m.actuator(i);
      if (acc.name) this.actuatorIdx.set(acc.name, i);
      // `actuator_gear` is laid out as 6 floats per actuator; for the motor
      // actuators in humanoid.xml only the first slot is meaningful.
      gear[i] = m.actuator_gear[i * 6] || 1;
      acc.delete();
    }
    this.actuatorGear = gear;
  }

  private cacheGeomDescriptors() {
    const m = this.model;
    if (!m) return;
    for (let i = 0; i < this.ngeom; i++) {
      this.geoms.push({
        index: i,
        type: m.geom_type[i] as GeomTypeValue,
        size: [m.geom_size[i * 3], m.geom_size[i * 3 + 1], m.geom_size[i * 3 + 2]],
        rgba: [m.geom_rgba[i * 4], m.geom_rgba[i * 4 + 1], m.geom_rgba[i * 4 + 2], m.geom_rgba[i * 4 + 3]],
        bodyId: m.geom_bodyid[i],
      });
    }
  }

  private requireLive(): { mujoco: MainModule; model: TypedMjModel; data: TypedMjData; rawModel: MjModel; rawData: MjData } {
    if (this.disposed || !this.mujoco || !this.model || !this.data || !this.rawModel || !this.rawData) {
      throw new SimDisposedError();
    }
    return { mujoco: this.mujoco, model: this.model, data: this.data, rawModel: this.rawModel, rawData: this.rawData };
  }

  step() {
    const live = this.requireLive();
    // Hooks may throw; one bad hook should not break the integration loop.
    for (const hook of this.stepHooks) {
      try { hook(); }
      catch (err) { console.error('[sim] step hook threw:', err); }
    }
    live.mujoco.mj_step(live.rawModel, live.rawData);
  }

  setStepHook(hook: StepHook): () => void {
    this.stepHooks.push(hook);
    return () => {
      const i = this.stepHooks.indexOf(hook);
      if (i >= 0) this.stepHooks.splice(i, 1);
    };
  }

  get geomXpos(): Float64Array { return this.requireLive().data.geom_xpos; }
  get geomXmat(): Float64Array { return this.requireLive().data.geom_xmat; }
  get qpos(): Float64Array { return this.requireLive().data.qpos; }
  get qvel(): Float64Array { return this.requireLive().data.qvel; }
  get nu(): number { return this.model?.nu ?? 0; }
  get ctrl(): Float64Array { return this.requireLive().data.ctrl; }
  get dt(): number { return this.model?.opt.timestep ?? 0.005; }
  get gear(): Float64Array { return this.actuatorGear; }

  setCtrl(i: number, v: number) {
    if (this.disposed || !this.data) return;
    if (i < 0 || i >= this.nu) return;
    this.data.ctrl[i] = v;
  }

  findJoint(name: string): JointAddr | null { return this.jointAddr.get(name) ?? null; }
  findActuator(name: string): number | null {
    const v = this.actuatorIdx.get(name);
    return v === undefined ? null : v;
  }

  rootPos(): [number, number, number] | null {
    const r = this.rootFreeJoint;
    if (!r || this.disposed || !this.data) return null;
    const q = this.data.qpos;
    return [q[r.qposAdr], q[r.qposAdr + 1], q[r.qposAdr + 2]];
  }

  actuators(): ActuatorInfo[] {
    const m = this.model;
    if (!m) return [];
    const out: ActuatorInfo[] = [];
    for (let i = 0; i < this.nu; i++) {
      const acc = m.actuator(i);
      const limited = m.actuator_ctrllimited[i] !== 0;
      const lo = m.actuator_ctrlrange[i * 2];
      const hi = m.actuator_ctrlrange[i * 2 + 1];
      const range: [number, number] = limited && hi > lo ? [lo, hi] : [-1, 1];
      out.push({
        index: i,
        name: acc.name || `act_${i}`,
        range,
        hasExplicitRange: limited,
        gearScalar: this.actuatorGear[i] || 1,
      });
      acc.delete();
    }
    return out;
  }

  reset() {
    const live = this.requireLive();
    live.mujoco.mj_resetData(live.rawModel, live.rawData);
    live.mujoco.mj_forward(live.rawModel, live.rawData);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stepHooks = [];
    this.rawData?.delete();
    this.rawModel?.delete();
    this.rawData = null;
    this.rawModel = null;
    this.model = null;
    this.data = null;
    this.mujoco = null;
  }
}

export { GeomType };
export type { GeomDescriptor, GeomTypeValue };
