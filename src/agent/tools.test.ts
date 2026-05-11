import { describe, expect, it } from 'vitest';
import { TOOL_SCHEMAS, executeTool } from './tools';
import type { HumanoidControl, Side, WalkDirection } from '../control/HumanoidControl';

interface RaiseCall { type: 'raiseArm'; side: Side; angle: number }
interface BendCall { type: 'bendElbow'; side: Side; angle: number }
interface LowerCall { type: 'lowerArm'; side: Side }
interface StandCall { type: 'stand'; pinRoot: boolean }
interface WalkCall { type: 'walk'; direction: WalkDirection; distance: number; speed: number }
interface TurnCall { type: 'turn'; degrees: number; rate: number }
interface NopCall { type: 'cancelMotion' | 'goLimp' }
type Call = RaiseCall | BendCall | LowerCall | StandCall | WalkCall | TurnCall | NopCall;

function makeStubControl(): HumanoidControl & { calls: Call[] } {
  const calls: Call[] = [];
  const stub = {
    calls,
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
  return stub as unknown as HumanoidControl & { calls: Call[] };
}

describe('TOOL_SCHEMAS', () => {
  it('exposes the expected tools', () => {
    const names = TOOL_SCHEMAS.map(s => s.name).sort();
    expect(names).toEqual([
      'bend_elbow',
      'lower_arm',
      'raise_arm',
      'release_all',
      'stand',
      'stop_motion',
      'turn',
      'walk',
    ]);
  });

  it('every tool declares an object input schema', () => {
    for (const t of TOOL_SCHEMAS) {
      expect(t.input_schema.type).toBe('object');
    }
  });
});

describe('executeTool', () => {
  it('dispatches raise_arm with validated args', () => {
    const control = makeStubControl();
    const res = executeTool(control, { name: 'raise_arm', input: { side: 'right', angle_deg: 90 } });
    expect(res.ok).toBe(true);
    expect(control.calls[0]).toEqual({ type: 'raiseArm', side: 'right', angle: 90 });
  });

  it('rejects raise_arm with invalid side', () => {
    const control = makeStubControl();
    const res = executeTool(control, { name: 'raise_arm', input: { side: 'middle', angle_deg: 90 } });
    expect(res.ok).toBe(false);
    expect(control.calls).toHaveLength(0);
  });

  it('rejects unknown tools', () => {
    const control = makeStubControl();
    const res = executeTool(control, { name: 'pirouette', input: {} });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/unknown tool/);
  });

  it('walk defaults speed to 1.0 m/s when omitted', () => {
    const control = makeStubControl();
    executeTool(control, { name: 'walk', input: { direction: 'forward', distance_m: 2 } });
    expect(control.calls[0]).toEqual({ type: 'walk', direction: 'forward', distance: 2, speed: 1.0 });
  });

  it('turn defaults rate to 90 deg/s when omitted', () => {
    const control = makeStubControl();
    executeTool(control, { name: 'turn', input: { degrees: -45 } });
    expect(control.calls[0]).toEqual({ type: 'turn', degrees: -45, rate: 90 });
  });

  it('stand respects pin_root', () => {
    const control = makeStubControl();
    executeTool(control, { name: 'stand', input: { pin_root: true } });
    expect(control.calls[0]).toEqual({ type: 'stand', pinRoot: true });
  });

  it('captures handler errors as ok=false', () => {
    const control = {
      raiseArm: () => { throw new Error('joint missing'); },
    } as unknown as HumanoidControl;
    const res = executeTool(control, { name: 'raise_arm', input: { side: 'left', angle_deg: 30 } });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/joint missing/);
  });
});
