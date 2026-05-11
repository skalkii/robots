// MuJoCo geom type enum (mjtGeom). See mujoco/mjmodel.h.
export const GeomType = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
  SDF: 8,
} as const;

export type GeomTypeValue = (typeof GeomType)[keyof typeof GeomType];

export interface GeomDescriptor {
  index: number;
  type: GeomTypeValue;
  size: [number, number, number];
  rgba: [number, number, number, number];
  bodyId: number;
}
