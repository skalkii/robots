import { describe, expect, it } from 'vitest';
import { MockAgent, extractAngle, extractDistance } from './MockAgent';
import type { HumanoidControl, Side, WalkDirection } from '../control/HumanoidControl';

type Call =
  | { type: 'raiseArm'; side: Side; angle: number }
  | { type: 'bendElbow'; side: Side; angle: number }
  | { type: 'lowerArm'; side: Side }
  | { type: 'stand'; pinRoot: boolean }
  | { type: 'walk'; direction: WalkDirection; distance: number; speed: number }
  | { type: 'turn'; degrees: number; rate: number }
  | { type: 'cancelMotion' }
  | { type: 'goLimp' };

function makeStubControl() {
  const calls: Call[] = [];
  const stub = {
    raiseArm: (side: Side, angle: number) => calls.push({ type: 'raiseArm', side, angle }),
    lowerArm: (side: Side) => calls.push({ type: 'lowerArm', side }),
    bendElbow: (side: Side, angle: number) => calls.push({ type: 'bendElbow', side, angle }),
    stand: (opts?: { pinRoot?: boolean }) => calls.push({ type: 'stand', pinRoot: !!opts?.pinRoot }),
    walk: (direction: WalkDirection, distance: number, speed: number) =>
      calls.push({ type: 'walk', direction, distance, speed }),
    turn: (degrees: number, rate: number) => calls.push({ type: 'turn', degrees, rate }),
    cancelMotion: () => calls.push({ type: 'cancelMotion' }),
    goLimp: () => calls.push({ type: 'goLimp' }),
  };
  return { calls, control: stub as unknown as HumanoidControl };
}

describe('MockAgent angle/distance extraction', () => {
  it('extracts "to N" angle', () => {
    expect(extractAngle('bend the elbow to 90')).toBe(90);
    expect(extractAngle('to -45')).toBe(-45);
  });

  it('extracts "N degrees" angle', () => {
    expect(extractAngle('rotate 45 degrees')).toBe(45);
    expect(extractAngle('20°')).toBe(20);
  });

  it('ignores arbitrary numbers without anchor', () => {
    expect(extractAngle("I'm 90% sure raise arm")).toBeNull();
  });

  it('extracts distance with units', () => {
    expect(extractDistance('walk 2 meters')).toBe(2);
    expect(extractDistance('move 0.5m')).toBe(0.5);
  });

  it('extracts trailing distance after walk verb', () => {
    expect(extractDistance('walk forward 3')).toBe(3);
  });
});

describe('MockAgent.respond', () => {
  it('handles simple imperatives', async () => {
    const { calls, control } = makeStubControl();
    const agent = new MockAgent();
    await agent.respond('raise your right arm', control);
    expect(calls).toContainEqual({ type: 'raiseArm', side: 'right', angle: 90 });
  });

  it('extracts a specific angle from "bend left elbow to 30"', async () => {
    const { calls, control } = makeStubControl();
    const agent = new MockAgent();
    await agent.respond('bend left elbow to 30', control);
    expect(calls).toContainEqual({ type: 'bendElbow', side: 'left', angle: 30 });
  });

  it('splits compound commands on "and"', async () => {
    const { calls, control } = makeStubControl();
    const agent = new MockAgent();
    await agent.respond('stand and walk forward 2', control);
    expect(calls).toContainEqual({ type: 'stand', pinRoot: false });
    expect(calls).toContainEqual({ type: 'walk', direction: 'forward', distance: 2, speed: 1 });
  });

  it('turns right with negative degrees', async () => {
    const { calls, control } = makeStubControl();
    const agent = new MockAgent();
    await agent.respond('turn right 45', control);
    expect(calls).toContainEqual({ type: 'turn', degrees: -45, rate: 90 });
  });

  it('returns a helpful prompt when no match', async () => {
    const { calls, control } = makeStubControl();
    const agent = new MockAgent();
    const turn = await agent.respond("the weather's nice today", control);
    expect(calls).toHaveLength(0);
    expect(turn.text).toMatch(/recognize/);
  });

  it('release verb triggers goLimp', async () => {
    const { calls, control } = makeStubControl();
    const agent = new MockAgent();
    await agent.respond('release everything', control);
    expect(calls).toContainEqual({ type: 'goLimp' });
  });
});
