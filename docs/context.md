# Humanoid Bot Control Interface

> Original context document. Read this first.

## What we're building

An interface that controls a humanoid robot via LLM tool calls. The model
takes **audio / video / text command** input, reasons about it, and invokes
tools that move the robot. Since real humanoid hardware isn't on hand, we
test against a **3D-rendered simulation** of the same robot. The control API
is designed to be hardware-agnostic — when real hardware arrives, only the
bottom adapter layer changes; the tool interface and the agent above it stay
the same.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser UI (React + TS)                        │
│  - mic / webcam capture                         │
│  - 3D viewport                                  │
│  - chat / command log                           │
└──────────────────┬──────────────────────────────┘
                   │
   ┌───────────────┴────────────────┐
   │                                │
┌──▼──────────────┐         ┌───────▼──────────┐
│  Agent layer    │ tools   │  Render layer    │
│  (LLM client)   ├────────►│  (Three.js)      │
└──┬──────────────┘         └───────▲──────────┘
   │ tool calls                     │
┌──▼──────────────┐                 │
│  Tool registry  │                 │
└──┬──────────────┘                 │
   │                                │
┌──▼──────────────────────────────┐ │
│  Control API (typed TS)         │ │
│  walk(), bendElbow(), stand(),… │ │
└──┬──────────────────────────────┘ │
   │ writes ctrl[]                  │ reads qpos[], xpos[]
┌──▼─────────────────────────────────┴────────────┐
│  MuJoCo WASM (physics + state)                  │
└─────────────────────────────────────────────────┘
```

## Stack (all TypeScript)

| Layer | Choice | Why |
|---|---|---|
| Physics | `@mujoco/mujoco` (official DeepMind) | Ships `.d.ts`, runs in browser |
| 3D render | Three.js + OrbitControls | First-class TS |
| Humanoid model | DeepMind `humanoid.xml` | Vendored at `public/assets/humanoid.xml` |
| Control API | TS module with PD targets | Wraps `data.ctrl` / `data.qpos` |
| Tool dispatch | Map-based registry | Single source of truth for both providers |
| LLM | Claude Haiku 4.5 (direct fetch) | Multimodal + tool use |
| Input | `getUserMedia` + Web Speech API | Browser-native |
| Build | Vite (Rolldown) + React + TS | Manual chunks for three/react/mujoco |
| Test | Vitest + jsdom | Unit-only |

## Implementation order (status)

1. ✅ Boot humanoid in browser
2. ✅ Manual joint sliders → `data.ctrl[]`
3. ✅ Typed control API (`stand`, `raiseArm`, `bendElbow`)
4. ✅ One LLM tool call end-to-end ("raise your right arm")
5. ✅ Audio input (Web Speech API)
6. ✅ Video input (webcam → multimodal Claude)
7. ✅ Locomotion (`walk` / `turn` — kinematic cheat)
8. ⏳ MCP wrap (optional — only if an external host needs to drive the robot)
9. ⏳ Real bipedal gait (out of scope; would need MPC or pretrained policy)

## Out of scope (for now)

- Real hardware integration
- Sim-to-real transfer
- Reinforcement learning training
- Photorealistic rendering
- Server-proxied LLM (currently direct browser → Anthropic; documented risk)

## Useful references

- MuJoCo WASM npm: https://www.npmjs.com/package/@mujoco/mujoco
- MuJoCo Menagerie: https://github.com/google-deepmind/mujoco_menagerie
- Three.js TS docs: https://threejs.org/docs/
- Anthropic Messages API: https://docs.anthropic.com/en/api/messages
