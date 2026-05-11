import type { HumanoidControl, Side } from '../control/HumanoidControl';

/**
 * Tool schema in Anthropic Messages-API format. The MockAgent accepts the
 * same shape so both providers share one dispatcher.
 *
 * Designed in terms of intent (raise arm, stand) rather than joint angles
 * so the model doesn't have to reason about MuJoCo internals.
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

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
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
  {
    name: 'lower_arm',
    description: 'Return one arm to the relaxed (0°) shoulder angle.',
    input_schema: {
      type: 'object',
      properties: {
        side: { type: 'string', enum: ['left', 'right'] },
      },
      required: ['side'],
    },
  },
  {
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
  {
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
  {
    name: 'release_all',
    description: 'Drop every active PD target and unpin the root. The robot goes limp.',
    input_schema: { type: 'object', properties: {} },
  },
];

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  message: string;
}

export function executeTool(control: HumanoidControl, call: ToolCall): ToolResult {
  try {
    switch (call.name) {
      case 'raise_arm': {
        const { side, angle_deg } = call.input as { side?: Side; angle_deg?: number };
        if (!isSide(side) || typeof angle_deg !== 'number') return bad('raise_arm: invalid args');
        control.raiseArm(side, angle_deg);
        return ok(`raised ${side} arm to ${angle_deg}°`);
      }
      case 'lower_arm': {
        const { side } = call.input as { side?: Side };
        if (!isSide(side)) return bad('lower_arm: invalid side');
        control.lowerArm(side);
        return ok(`lowered ${side} arm`);
      }
      case 'bend_elbow': {
        const { side, angle_deg } = call.input as { side?: Side; angle_deg?: number };
        if (!isSide(side) || typeof angle_deg !== 'number') return bad('bend_elbow: invalid args');
        control.bendElbow(side, angle_deg);
        return ok(`bent ${side} elbow to ${angle_deg}°`);
      }
      case 'stand': {
        const { pin_root } = call.input as { pin_root?: boolean };
        control.stand({ pinRoot: pin_root === true });
        return ok(`standing${pin_root ? ' (root pinned)' : ''}`);
      }
      case 'release_all': {
        control.releaseAll();
        return ok('released all targets');
      }
      default:
        return bad(`unknown tool: ${call.name}`);
    }
  } catch (err) {
    return bad((err as Error).message);
  }
}

function isSide(v: unknown): v is Side { return v === 'left' || v === 'right'; }
function ok(message: string): ToolResult { return { ok: true, message }; }
function bad(message: string): ToolResult { return { ok: false, message }; }
