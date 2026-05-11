import loadMujoco from '@mujoco/mujoco';
import type { MainModule, MjModel, MjData } from '@mujoco/mujoco';
import { GeomType, type GeomDescriptor, type GeomTypeValue } from './types';

export interface GeomTransform {
  position: [number, number, number];
  // Row-major 3x3 rotation matrix flattened to 9 entries.
  matrix: [number, number, number, number, number, number, number, number, number];
}

export class MujocoSim {
  private mujoco!: MainModule;
  private model!: MjModel;
  private data!: MjData;

  ngeom = 0;
  nbody = 0;
  njnt = 0;

  geoms: GeomDescriptor[] = [];

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

    this.cacheGeomDescriptors();
    this.mujoco.mj_forward(this.model, this.data);
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
    this.mujoco.mj_step(this.model, this.data);
  }

  get geomXpos(): Float64Array { return this.data.geom_xpos as Float64Array; }
  get geomXmat(): Float64Array { return this.data.geom_xmat as Float64Array; }

  get nu(): number { return (this.model as unknown as { nu: number }).nu; }
  get ctrl(): Float64Array { return (this.data as unknown as { ctrl: Float64Array }).ctrl; }

  setCtrl(i: number, v: number) { this.ctrl[i] = v; }

  dispose() {
    this.data.delete();
    this.model.delete();
  }
}

export { GeomType };
export type { GeomDescriptor, GeomTypeValue };
