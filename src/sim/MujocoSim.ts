import loadMujoco from '@mujoco/mujoco';
import type { MainModule, MjModel, MjData } from '@mujoco/mujoco';
import { GeomType, type GeomDescriptor, type GeomTypeValue } from './types';

export interface GeomTransform {
  position: [number, number, number];
  matrix: [number, number, number, number, number, number, number, number, number];
}

export interface ActuatorInfo {
  index: number;
  name: string;
  range: [number, number];
  hasExplicitRange: boolean;
}

export interface JointAddr {
  /** Index into `data.qpos`. For hinge/slide joints, the joint angle / position. */
  qposAdr: number;
  /** Index into `data.qvel`. */
  dofAdr: number;
  /** mjtJoint enum value: 0 free, 1 ball, 2 slide, 3 hinge. */
  type: number;
}

export type StepHook = () => void;

export class MujocoSim {
  private mujoco!: MainModule;
  private model!: MjModel;
  private data!: MjData;

  ngeom = 0;
  nbody = 0;
  njnt = 0;
  nq = 0;
  nv = 0;

  geoms: GeomDescriptor[] = [];

  /** Snapshot of qpos taken immediately after the initial mj_forward, before
   *  any user-initiated step. Useful for pinning the model to its default
   *  pose (e.g. the kinematic stand-cheat). */
  initialQpos!: Float64Array;

  /** If the model's first joint is a free joint (mjJNT_FREE = 0), this points
   *  at it. Null otherwise. The free joint takes 7 qpos entries and 6 qvel
   *  entries starting at the given addresses. */
  rootFreeJoint: { qposAdr: number; dofAdr: number } | null = null;

  private jointAddr = new Map<string, JointAddr>();
  private actuatorIdx = new Map<string, number>();
  private stepHooks: StepHook[] = [];

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

    this.model = this.mujoco.MjModel.from_xml_string(xmlText);
    this.data = new this.mujoco.MjData(this.model);

    this.ngeom = this.model.ngeom;
    this.nbody = this.model.nbody;
    this.njnt = this.model.njnt;
    this.nq = (this.model as unknown as { nq: number }).nq;
    this.nv = (this.model as unknown as { nv: number }).nv;

    this.cacheGeomDescriptors();
    this.cacheNameLookups();
    this.detectRootFreeJoint();
    this.mujoco.mj_forward(this.model, this.data);
    // Snapshot the just-computed default pose for kinematic pinning.
    this.initialQpos = new Float64Array(this.qpos);
  }

  private detectRootFreeJoint() {
    if (this.njnt === 0) return;
    const jntType = this.model.jnt_type as Int32Array;
    const qposAdr = this.model.jnt_qposadr as Int32Array;
    const dofAdr = this.model.jnt_dofadr as Int32Array;
    // mjJNT_FREE = 0, mjJNT_BALL = 1, mjJNT_SLIDE = 2, mjJNT_HINGE = 3.
    if (jntType[0] === 0) {
      this.rootFreeJoint = { qposAdr: qposAdr[0], dofAdr: dofAdr[0] };
    }
  }

  private cacheNameLookups() {
    const qposAdr = this.model.jnt_qposadr as Int32Array;
    const dofAdr = this.model.jnt_dofadr as Int32Array;
    const jntType = this.model.jnt_type as Int32Array;
    for (let i = 0; i < this.njnt; i++) {
      const acc = this.model.jnt(i);
      if (acc.name) {
        this.jointAddr.set(acc.name, {
          qposAdr: qposAdr[i],
          dofAdr: dofAdr[i],
          type: jntType[i],
        });
      }
      acc.delete();
    }
    for (let i = 0; i < this.nu; i++) {
      const acc = this.model.actuator(i);
      if (acc.name) this.actuatorIdx.set(acc.name, i);
      acc.delete();
    }
  }

  private cacheGeomDescriptors() {
    const types = this.model.geom_type as Int32Array;
    const sizes = this.model.geom_size as Float64Array;
    const rgba = this.model.geom_rgba as Float32Array;
    const bodyIds = this.model.geom_bodyid as Int32Array;
    for (let i = 0; i < this.ngeom; i++) {
      this.geoms.push({
        index: i,
        type: types[i] as GeomTypeValue,
        size: [sizes[i * 3], sizes[i * 3 + 1], sizes[i * 3 + 2]],
        rgba: [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]],
        bodyId: bodyIds[i],
      });
    }
  }

  step() {
    for (const hook of this.stepHooks) hook();
    this.mujoco.mj_step(this.model, this.data);
  }

  /** Register a callback that fires immediately before every physics step.
   *  Returns an unregister function. */
  setStepHook(hook: StepHook): () => void {
    this.stepHooks.push(hook);
    return () => {
      const i = this.stepHooks.indexOf(hook);
      if (i >= 0) this.stepHooks.splice(i, 1);
    };
  }

  get geomXpos(): Float64Array { return this.data.geom_xpos as Float64Array; }
  get geomXmat(): Float64Array { return this.data.geom_xmat as Float64Array; }
  get qpos(): Float64Array { return this.data.qpos as Float64Array; }
  get qvel(): Float64Array { return this.data.qvel as Float64Array; }

  get nu(): number { return (this.model as unknown as { nu: number }).nu; }
  get ctrl(): Float64Array { return (this.data as unknown as { ctrl: Float64Array }).ctrl; }
  /** Physics integration timestep in seconds (from `model.opt.timestep`). */
  get dt(): number { return this.model.opt.timestep; }

  setCtrl(i: number, v: number) { this.ctrl[i] = v; }

  findJoint(name: string): JointAddr | null { return this.jointAddr.get(name) ?? null; }
  findActuator(name: string): number | null {
    const v = this.actuatorIdx.get(name);
    return v === undefined ? null : v;
  }

  actuators(): ActuatorInfo[] {
    const ctrlLimited = this.model.actuator_ctrllimited as Uint8Array;
    const ctrlRange = this.model.actuator_ctrlrange as Float64Array;
    const out: ActuatorInfo[] = [];
    for (let i = 0; i < this.nu; i++) {
      const acc = this.model.actuator(i);
      const limited = ctrlLimited[i] !== 0;
      const lo = ctrlRange[i * 2];
      const hi = ctrlRange[i * 2 + 1];
      const range: [number, number] = limited && hi > lo ? [lo, hi] : [-1, 1];
      out.push({ index: i, name: acc.name || `act_${i}`, range, hasExplicitRange: limited });
      acc.delete();
    }
    return out;
  }

  reset() {
    this.mujoco.mj_resetData(this.model, this.data);
    this.mujoco.mj_forward(this.model, this.data);
  }

  dispose() {
    this.data.delete();
    this.model.delete();
  }
}

export { GeomType };
export type { GeomDescriptor, GeomTypeValue };
