import { describe, expect, it } from 'vitest';
import { quatToYaw, worldDirFromLocal, degToRad } from './HumanoidControl';

describe('quatToYaw', () => {
  it('returns 0 for identity quaternion', () => {
    expect(quatToYaw(1, 0, 0, 0)).toBeCloseTo(0, 6);
  });

  it('returns π/2 for a 90° yaw about Z', () => {
    const half = Math.PI / 4;
    const w = Math.cos(half);
    const z = Math.sin(half);
    expect(quatToYaw(w, 0, 0, z)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('returns -π/2 for a -90° yaw', () => {
    const half = -Math.PI / 4;
    const w = Math.cos(half);
    const z = Math.sin(half);
    expect(quatToYaw(w, 0, 0, z)).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe('worldDirFromLocal', () => {
  it('at yaw=0, forward is +X', () => {
    const [x, y] = worldDirFromLocal('forward', 0);
    expect(x).toBeCloseTo(1, 6); expect(y).toBeCloseTo(0, 6);
  });

  it('at yaw=0, left is +Y', () => {
    const [x, y] = worldDirFromLocal('left', 0);
    expect(x).toBeCloseTo(0, 6); expect(y).toBeCloseTo(1, 6);
  });

  it('at yaw=π/2, forward is +Y', () => {
    const [x, y] = worldDirFromLocal('forward', Math.PI / 2);
    expect(x).toBeCloseTo(0, 6); expect(y).toBeCloseTo(1, 6);
  });

  it('backward is negation of forward', () => {
    const [fx, fy] = worldDirFromLocal('forward', 0.3);
    const [bx, by] = worldDirFromLocal('backward', 0.3);
    expect(bx).toBeCloseTo(-fx, 6);
    expect(by).toBeCloseTo(-fy, 6);
  });

  it('right is negation of left', () => {
    const [lx, ly] = worldDirFromLocal('left', 0.7);
    const [rx, ry] = worldDirFromLocal('right', 0.7);
    expect(rx).toBeCloseTo(-lx, 6);
    expect(ry).toBeCloseTo(-ly, 6);
  });
});

describe('degToRad', () => {
  it('converts 180° to π', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 6);
  });
  it('round-trips through inverse for 0 and 45', () => {
    expect(degToRad(0)).toBe(0);
    expect(degToRad(45)).toBeCloseTo(Math.PI / 4, 6);
  });
});
