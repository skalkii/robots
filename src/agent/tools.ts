import type { HumanoidControl, Side, WalkDirection } from '../control/HumanoidControl';

/**
 * Tool schema in Anthropic Messages-API format. The MockAgent accepts the
 * same shape so both providers share one dispatcher.
 *
 * Tools are registered once via `register()`. The registry is the single
 * source of truth: `TOOL_SCHEMAS` (for prompt construction) and
 * `executeTool` (for dispatch) both read from it. Adding a tool = add one
 * `register({...})` call.
 */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; enum?: string[]; description?: string }>;
    required?: string[];
  };
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  message: string;
}

type ToolHandler = (control: HumanoidControl, input: Record<string, unknown>) => ToolResult;

interface ToolRegistration {
  schema: ToolSchema;
  handler: ToolHandler;
}

const REGISTRY = new Map<string, ToolRegistration>();

function register(reg: ToolRegistration) {
  if (REGISTRY.has(reg.schema.name)) {
    throw new Error(`tool already registered: ${reg.schema.name}`);
  }
  REGISTRY.set(reg.schema.name, reg);
}

// ──────────────────────────────────────────────────────────────────────────
// Tool definitions
// ──────────────────────────────────────────────────────────────────────────

register({
  schema: {
    name: 'raise_arm',
    description:
      "Raise one of the humanoid's arms toward a target shoulder angle in degrees. " +
      '0° is the relaxed default pose; ~90° is roughly horizontal in front of the torso. ' +
      'Use this to point, wave, or reach.',
    input_schema: {
      type: 'object',
      properties: {
        side: { type: 'string', enum: ['left', 'right'], description: 'Which arm to move.' },
        angle_deg: { type: 'number', description: 'Target shoulder angle in degrees.' },
      },
      required: ['side', 'angle_deg'],
    },
  },
  handler: (control, input) => {
    const { side, angle_deg } = input as { side?: Side; angle_deg?: number };
    if (!isSide(side) || typeof angle_deg !== 'number') return bad('raise_arm: invalid args');
    control.raiseArm(side, angle_deg);
    return ok(`raised ${side} arm to ${angle_deg}°`);
  },
});

register({
  schema: {
    name: 'lower_arm',
    description: 'Return one arm to the relaxed (0°) shoulder angle.',
    input_schema: {
      type: 'object',
      properties: { side: { type: 'string', enum: ['left', 'right'] } },
      required: ['side'],
    },
  },
  handler: (control, input) => {
    const { side } = input as { side?: Side };
    if (!isSide(side)) return bad('lower_arm: invalid side');
    control.lowerArm(side);
    return ok(`lowered ${side} arm`);
  },
});

register({
  schema: {
    name: 'bend_elbow',
    description: 'Bend one elbow to a target angle in degrees. Higher values curl the forearm in.',
    input_schema: {
      type: 'object',
      properties: {
        side: { type: 'string', enum: ['left', 'right'] },
        angle_deg: { type: 'number', description: 'Target elbow angle in degrees.' },
      },
      required: ['side', 'angle_deg'],
    },
  },
  handler: (control, input) => {
    const { side, angle_deg } = input as { side?: Side; angle_deg?: number };
    if (!isSide(side) || typeof angle_deg !== 'number') return bad('bend_elbow: invalid args');
    control.bendElbow(side, angle_deg);
    return ok(`bent ${side} elbow to ${angle_deg}°`);
  },
});

register({
  schema: {
    name: 'stand',
    description:
      'Hold the humanoid in its default standing pose. Set pin_root=true to lock the torso ' +
      'kinematically (guaranteed upright but unrealistic). false uses physics-only PD control ' +
      '(more realistic but will eventually fall over).',
    input_schema: {
      type: 'object',
      properties: {
        pin_root: { type: 'boolean', description: 'Whether to kinematically pin the torso.' },
      },
    },
  },
  handler: (control, input) => {
    const { pin_root } = input as { pin_root?: boolean };
    control.stand({ pinRoot: pin_root === true });
    return ok(`standing${pin_root ? ' (root pinned)' : ''}`);
  },
});

register({
  schema: {
    name: 'walk',
    description:
      'Kinematically translate the robot a given distance in a robot-relative direction. ' +
      'Limb posture is preserved but the gait is faked (the torso glides) — this is a demo cheat. ' +
      'Typical speeds are 0.5–1.5 m/s. Default speed is 1.0 m/s if omitted.',
    input_schema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['forward', 'backward', 'left', 'right'] },
        distance_m: { type: 'number', description: 'Distance to travel in meters.' },
        speed_mps: { type: 'number', description: 'Optional speed in meters per second.' },
      },
      required: ['direction', 'distance_m'],
    },
  },
  handler: (control, input) => {
    const { direction, distance_m, speed_mps } = input as {
      direction?: WalkDirection;
      distance_m?: number;
      speed_mps?: number;
    };
    if (!isWalkDir(direction) || typeof distance_m !== 'number') return bad('walk: invalid args');
    control.walk(direction, distance_m, typeof speed_mps === 'number' ? speed_mps : 1.0);
    return ok(`walking ${direction} ${distance_m}m`);
  },
});

register({
  schema: {
    name: 'turn',
    description:
      'Rotate the robot in place about its vertical axis. Positive degrees turn counter-clockwise ' +
      "(viewed from above) — i.e. to the robot's left. Default rate 90°/s.",
    input_schema: {
      type: 'object',
      properties: {
        degrees: { type: 'number', description: 'Yaw delta in degrees (+ left, - right).' },
        rate_dps: { type: 'number', description: 'Optional angular rate in degrees per second.' },
      },
      required: ['degrees'],
    },
  },
  handler: (control, input) => {
    const { degrees, rate_dps } = input as { degrees?: number; rate_dps?: number };
    if (typeof degrees !== 'number') return bad('turn: invalid args');
    control.turn(degrees, typeof rate_dps === 'number' ? rate_dps : 90);
    return ok(`turning ${degrees}°`);
  },
});

register({
  schema: {
    name: 'stop_motion',
    description: 'Cancel any in-progress walk/turn. Limb PD targets are kept.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: control => {
    control.cancelMotion();
    return ok('stopped locomotion');
  },
});

register({
  schema: {
    name: 'release_all',
    description: 'Drop every active PD target, cancel locomotion, and unpin the root. The robot goes limp.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: control => {
    control.goLimp();
    return ok('released all targets');
  },
});

// ──────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────

export const TOOL_SCHEMAS: ToolSchema[] = Array.from(REGISTRY.values(), r => r.schema);

export function executeTool(control: HumanoidControl, call: ToolCall): ToolResult {
  const reg = REGISTRY.get(call.name);
  if (!reg) return bad(`unknown tool: ${call.name}`);
  try { return reg.handler(control, call.input); }
  catch (err) { return bad((err as Error).message); }
}

function isSide(v: unknown): v is Side { return v === 'left' || v === 'right'; }
function isWalkDir(v: unknown): v is WalkDirection {
  return v === 'forward' || v === 'backward' || v === 'left' || v === 'right';
}
function ok(message: string): ToolResult { return { ok: true, message }; }
function bad(message: string): ToolResult { return { ok: false, message }; }
