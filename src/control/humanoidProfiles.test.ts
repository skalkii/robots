import { describe, expect, it } from 'vitest';
import {
  DEEPMIND_HUMANOID_PROFILE,
  UNITREE_G1_PROFILE,
  DEFAULT_HUMANOID_PROFILE,
  type HumanoidProfile,
} from './humanoidProfiles';

describe('HumanoidProfile registry', () => {
  it('exposes unique ids', () => {
    const ids = new Set([DEEPMIND_HUMANOID_PROFILE.id, UNITREE_G1_PROFILE.id]);
    expect(ids.size).toBe(2);
  });

  it('default points at the DeepMind humanoid', () => {
    expect(DEFAULT_HUMANOID_PROFILE.id).toBe(DEEPMIND_HUMANOID_PROFILE.id);
  });
});

describe('DEEPMIND_HUMANOID_PROFILE', () => {
  it('returns both shoulder hinges per side', () => {
    expect(DEEPMIND_HUMANOID_PROFILE.shoulderJoints('left')).toEqual(['shoulder1_left', 'shoulder2_left']);
    expect(DEEPMIND_HUMANOID_PROFILE.shoulderJoints('right')).toEqual(['shoulder1_right', 'shoulder2_right']);
  });

  it('returns a single elbow joint per side', () => {
    expect(DEEPMIND_HUMANOID_PROFILE.elbowJoints('left')).toEqual(['elbow_left']);
  });

  it('reports no head joint', () => {
    expect(DEEPMIND_HUMANOID_PROFILE.hasHeadJoint).toBe(false);
    expect(DEEPMIND_HUMANOID_PROFILE.headYawJoint).toBeUndefined();
  });
});

describe('UNITREE_G1_PROFILE (sketch)', () => {
  it('uses snake_case joint names prefixed by side', () => {
    expect(UNITREE_G1_PROFILE.shoulderJoints('left')).toEqual([
      'left_shoulder_pitch_joint',
      'left_shoulder_roll_joint',
    ]);
    expect(UNITREE_G1_PROFILE.elbowJoints('right')).toEqual(['right_elbow_joint']);
  });
});

describe('HumanoidProfile contract', () => {
  const profiles: HumanoidProfile[] = [DEEPMIND_HUMANOID_PROFILE, UNITREE_G1_PROFILE];
  for (const p of profiles) {
    it(`${p.id} returns non-empty joint lists per side`, () => {
      for (const side of ['left', 'right'] as const) {
        expect(p.shoulderJoints(side).length).toBeGreaterThan(0);
        expect(p.elbowJoints(side).length).toBeGreaterThan(0);
      }
    });
    it(`${p.id} keeps left/right joint lists disjoint`, () => {
      const l = new Set([...p.shoulderJoints('left'), ...p.elbowJoints('left')]);
      const r = new Set([...p.shoulderJoints('right'), ...p.elbowJoints('right')]);
      for (const j of l) expect(r.has(j)).toBe(false);
    });
  }
});
