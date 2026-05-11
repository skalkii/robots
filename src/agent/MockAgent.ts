import type { HumanoidControl } from '../control/HumanoidControl';
import type { AgentClient, AgentTurn } from './AgentClient';
import { runToolCalls } from './AgentClient';
import type { ToolCall } from './tools';
import type { CapturedFrame } from './WebcamCapture';

/**
 * Offline regex-driven agent. Tokenizes the input into clauses (split on
 * conjunctions and punctuation) and parses each clause independently, so
 * "raise the right arm and bend the left elbow to 90" produces two correct
 * tool calls instead of one mashed-up match.
 *
 * Angle extraction is anchored to phrases like "to N" or "N degrees" rather
 * than scooping up any number in the clause — fixes the "I'm 90% sure"
 * footgun.
 */
export class MockAgent implements AgentClient {
  readonly label = 'Mock (offline)';

  async respond(
    userText: string,
    control: HumanoidControl,
    image?: CapturedFrame | null,
    // Mock has no streaming; we ignore the callback rather than fake it.
    _onStream?: unknown,
  ): Promise<AgentTurn> {
    void _onStream;
    const calls = parse(userText);
    const imageNote = image ? ` [saw ${image.width}×${image.height} frame]` : '';
    if (calls.length === 0) {
      return {
        text:
          `(mock)${imageNote} I didn't recognize that. Try: 'raise your right arm', 'bend left elbow to 90', 'stand', 'walk forward 2', 'turn left 90', or 'release'.`,
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

const CLAUSE_SPLIT = /\s+then\s+|\s+and\s+|;|,/g;

function parse(raw: string): ToolCall[] {
  const text = raw.toLowerCase();
  const clauses = text.split(CLAUSE_SPLIT).map(s => s.trim()).filter(Boolean);
  const out: ToolCall[] = [];
  for (const c of clauses) {
    const call = parseClause(c);
    if (call) out.push(...call);
  }
  return out;
}

function parseClause(clause: string): ToolCall[] | null {
  // Locomotion verbs come first because "walk forward 2" must not be mistaken
  // for an arm command.
  const walkVerb = /\b(walk|step|go|move)\b/.test(clause);
  const turnVerb = /\b(turn|rotate|spin)\b/.test(clause);

  if (walkVerb) {
    const dirMatch = clause.match(/\b(forward|backward|back|left|right)\b/);
    if (dirMatch) {
      const dir = dirMatch[1] === 'back' ? 'backward' : dirMatch[1];
      const distance = extractDistance(clause) ?? 1;
      return [{ name: 'walk', input: { direction: dir, distance_m: distance } }];
    }
  }

  if (turnVerb) {
    const dirMatch = clause.match(/\b(left|right)\b/);
    let mag = extractAngle(clause);
    if (mag === null) {
      // "turn right 45" — bare number after the verb is unambiguous in a
      // turn context, so accept it without the "to"/"deg" anchor.
      const bare = clause.match(/(-?\d+(?:\.\d+)?)/);
      if (bare) mag = Number(bare[1]);
    }
    if (typeof mag === 'number') {
      const sign = dirMatch?.[1] === 'right' ? -1 : 1;
      return [{ name: 'turn', input: { degrees: sign * Math.abs(mag) } }];
    }
  }

  if (/\bstand\b/.test(clause)) {
    const pinRoot = /\bpin|hold|don'?t fall|stay up\b/.test(clause);
    return [{ name: 'stand', input: { pin_root: pinRoot } }];
  }

  if (/\b(release|relax|go limp|drop everything|limp)\b/.test(clause)) {
    return [{ name: 'release_all', input: {} }];
  }

  if (/\bstop\b/.test(clause)) {
    return [{ name: 'stop_motion', input: {} }];
  }

  // Arm + elbow commands.
  const side = clause.match(/\b(left|right)\b/)?.[1] as 'left' | 'right' | undefined;
  if (!side) return null;

  if (/\b(raise|lift|wave)\b/.test(clause) && /\barm\b/.test(clause)) {
    const angle = extractAngle(clause) ?? 90;
    return [{ name: 'raise_arm', input: { side, angle_deg: angle } }];
  }
  if (/\b(lower|drop)\b/.test(clause) && /\barm\b/.test(clause)) {
    return [{ name: 'lower_arm', input: { side } }];
  }
  if (/\b(bend|curl)\b/.test(clause) && /\belbow\b/.test(clause)) {
    const angle = extractAngle(clause) ?? 90;
    return [{ name: 'bend_elbow', input: { side, angle_deg: angle } }];
  }

  return null;
}

/** Pulls an angle from phrases like "to 90", "90 deg", or "90°". Does NOT
 *  scoop up arbitrary numbers like percentages. */
export function extractAngle(clause: string): number | null {
  // Anchored: must be preceded by "to" or followed by deg/°.
  const m =
    clause.match(/\bto\s+(-?\d+(?:\.\d+)?)\b/) ??
    clause.match(/(-?\d+(?:\.\d+)?)\s*(?:deg|degree|degrees|°)/);
  return m ? Number(m[1]) : null;
}

/** Distance like "2 meters", "2m", or just "2" after a walk verb. */
export function extractDistance(clause: string): number | null {
  const m =
    clause.match(/(-?\d+(?:\.\d+)?)\s*(?:m\b|meter|meters)/) ??
    clause.match(/(?:walk|step|go|move)\b[^0-9]*(-?\d+(?:\.\d+)?)/);
  return m ? Math.abs(Number(m[1])) : null;
}
