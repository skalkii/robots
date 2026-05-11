import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn } from './AgentClient';
import { runToolCalls } from './AgentClient';
import type { ToolCall } from './tools';
import type { CapturedFrame } from './WebcamCapture';

export class MockAgent implements AgentClient {
  readonly label = 'Mock (offline)';

  async respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
  ): Promise<AgentTurn> {
    const calls = parse(userText);
    const imageNote = image ? ` [saw ${image.width}×${image.height} frame]` : '';
    if (calls.length === 0) {
      return {
        text:
          `(mock)${imageNote} I didn't recognize that. Try: 'raise your right arm', 'bend left elbow to 90', 'stand', or 'release'.`,
        tools: [],
      };
    }
    const tools = runToolCalls(control, calls);
    const summary = tools
      .map(t => (t.result.ok ? `✓ ${t.result.message}` : `✗ ${t.result.message}`))
      .join('; ');
    return { text: `(mock)${imageNote} ${summary}`, tools };
  }
}

function parse(raw: string): ToolCall[] {
  const text = raw.toLowerCase();
  const calls: ToolCall[] = [];

  if (/\bstand\b/.test(text)) {
    const pinRoot = /pin|hold|don'?t fall|stay up/.test(text);
    calls.push({ name: 'stand', input: { pin_root: pinRoot } });
  }

  if (/\b(release|relax|go limp|drop)\b/.test(text)) {
    calls.push({ name: 'release_all', input: {} });
  }

  // Locomotion: "walk forward 2 meters", "go back 1m", "step left .5".
  const walkMatch = text.match(/\b(?:walk|step|go|move)\b[^.]*\b(forward|backward|back|left|right)\b[^.]*?(-?\d+(?:\.\d+)?)?\s*(?:m|meter|meters)?/);
  if (walkMatch) {
    const dirRaw = walkMatch[1];
    const dir = dirRaw === 'back' ? 'backward' : (dirRaw as 'forward' | 'backward' | 'left' | 'right');
    const distance = walkMatch[2] ? Number(walkMatch[2]) : 1;
    calls.push({ name: 'walk', input: { direction: dir, distance_m: distance } });
  }

  // Turning: "turn left 90", "rotate 45 degrees right".
  const turnMatch = text.match(/\b(?:turn|rotate|spin)\b[^.]*?(?:(left|right)\s+)?(-?\d+(?:\.\d+)?)(?:\s*(?:deg|degree|°))?(?:[^.]*?(left|right))?/);
  if (turnMatch && /\b(?:turn|rotate|spin)\b/.test(text)) {
    const dir = turnMatch[1] || turnMatch[3];
    const magnitude = Number(turnMatch[2]);
    const sign = dir === 'right' ? -1 : 1;
    calls.push({ name: 'turn', input: { degrees: sign * magnitude } });
  }

  if (/\bstop\b/.test(text) && !calls.some(c => c.name === 'walk' || c.name === 'turn')) {
    calls.push({ name: 'stop_motion', input: {} });
  }

  for (const side of ['left', 'right'] as const) {
    if (new RegExp(`(raise|lift|wave)[^.]*\\b${side}\\b[^.]*\\barm\\b|\\b${side}\\b[^.]*\\barm\\b[^.]*\\b(up|raise|wave)\\b`).test(text)) {
      const angle = extractAngle(text) ?? 90;
      calls.push({ name: 'raise_arm', input: { side, angle_deg: angle } });
    }
    if (new RegExp(`(lower|drop)[^.]*\\b${side}\\b[^.]*\\barm\\b`).test(text)) {
      calls.push({ name: 'lower_arm', input: { side } });
    }
    if (new RegExp(`(bend|curl)[^.]*\\b${side}\\b[^.]*\\belbow\\b|\\b${side}\\b[^.]*\\belbow\\b[^.]*\\bto\\b`).test(text)) {
      const angle = extractAngle(text) ?? 90;
      calls.push({ name: 'bend_elbow', input: { side, angle_deg: angle } });
    }
  }

  return calls;
}

function extractAngle(text: string): number | null {
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*(?:deg|degree|°)?/);
  return m ? Number(m[1]) : null;
}
