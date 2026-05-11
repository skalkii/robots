import type { Side } from './HumanoidControl';

/**
 * Per-model knowledge that the control layer needs to map intent-shaped
 * commands (`raiseArm('left', 90)`) onto the joint/actuator names that
 * actually exist in the MJCF.
 *
 * Adding a new model = write one of these records and pass it via
 * `new HumanoidControl(sim, { profile })`. No control-method bodies need
 * to change.
 */
export interface HumanoidProfile {
  id: string;
  displayName: string;
  /** Joints driven by `raiseArm`. Most humanoids have two shoulder DOFs. */
  shoulderJoints(side: Side): string[];
  /** Joint(s) driven by `bendElbow`. */
  elbowJoints(side: Side): string[];
  /** Whether `turnHead` / `lookAt` are usable on this model. */
  hasHeadJoint: boolean;
  headYawJoint?: string;
  headPitchJoint?: string;
}

/**
 * Profile for the canonical DeepMind humanoid (the model vendored at
 * `public/assets/humanoid.xml`). Each shoulder is driven by two motors
 * along tilted axes; the elbow is a single hinge. There is no head joint.
 */
export const DEEPMIND_HUMANOID_PROFILE: HumanoidProfile = {
  id: 'deepmind-humanoid',
  displayName: 'DeepMind humanoid',
  shoulderJoints: (side) => [`shoulder1_${side}`, `shoulder2_${side}`],
  elbowJoints: (side) => [`elbow_${side}`],
  hasHeadJoint: false,
};

/**
 * Profile sketch for Unitree G1 from MuJoCo Menagerie. Useful as a worked
 * example of how to plug in a new model — the actual G1 MJCF needs to be
 * vendored separately (it depends on ~30 mesh files), and the joint names
 * below must be verified against the shipping XML.
 */
export const UNITREE_G1_PROFILE: HumanoidProfile = {
  id: 'unitree-g1',
  displayName: 'Unitree G1 (sketch)',
  shoulderJoints: (side) => [`${side}_shoulder_pitch_joint`, `${side}_shoulder_roll_joint`],
  elbowJoints: (side) => [`${side}_elbow_joint`],
  hasHeadJoint: false,
};

export const DEFAULT_HUMANOID_PROFILE = DEEPMIND_HUMANOID_PROFILE;
