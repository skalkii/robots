# Humanoid Bot Control Interface

A browser-based humanoid robot control interface where the user speaks (or types, or shows the webcam) and an LLM picks the right tool calls to move the robot. The robot runs as a MuJoCo WASM physics simulation rendered with Three.js — no hardware required.

```
voice / text / video  →  LLM (tool calls)  →  typed control API  →  MuJoCo (physics)  →  Three.js (render)
```

## What's in here

- **MuJoCo WASM** (`@mujoco/mujoco` 3.8) running the canonical DeepMind humanoid (`humanoid.xml`) directly in the browser.
- **Three.js scene** that mirrors the sim each frame from `data.geom_xpos` / `geom_xmat`, with OrbitControls for camera, shadow-casting lights, and a Z-up→Y-up parent so MuJoCo's world reads naturally.
- **Typed `HumanoidControl` API** with PD joint targets that ride the simulator's step hook: `raiseArm`, `lowerArm`, `bendElbow`, `stand` (with optional kinematic root pin), `releaseAll`. `turnHead` / `lookAt` exist but throw `UnsupportedControlError` because the stock humanoid model has no head joint.
- **Two agent providers** behind one interface:
  - `MockAgent` — regex-based offline agent so the chat surface works without an API key.
  - `ClaudeAgent` — direct `fetch` to the Anthropic Messages API (model: `claude-haiku-4-5-20251001`), with tool-use loop and ephemeral prompt-caching on the system prompt.
- **Multimodal input**:
  - 🎙 Mic button — Web Speech API (`(webkit)SpeechRecognition`) auto-submits the final transcript.
  - 📷 Webcam button — `getUserMedia` + canvas-rasterized JPEG attached as an image content block to multimodal turns.
- **Sliders + commands panel** — per-actuator sliders bound directly to `data.ctrl[]`, plus buttons that exercise the typed control API (`Raise L/R arm`, `Bend L/R elbow`, `Stand (PD)`, `Stand (pinned)`, `Release`).

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview
```

Type-check only:

```bash
npx tsc -b --noEmit
```

### Using Claude

1. Click ⚙ in the chat panel (bottom-left).
2. Switch provider to **Claude Haiku 4.5 (API)**.
3. Paste an Anthropic API key (stored in `localStorage` — see warnings below).
4. Save.
5. Type or speak a command: *"raise your right arm to 90 degrees and bend the elbow to about 100"*.

The browser hits the Anthropic API directly using the `anthropic-dangerous-direct-browser-access: true` header. No backend involved.

> **Security note.** Direct browser calls expose the API key to anyone with access to your browser/devtools. For production, proxy through a server you control. This project ships the direct-browser path for ergonomics — it's appropriate for local development and demos, not for sharing a URL with a baked-in key.

## Project layout

```
src/
  sim/              MuJoCo WASM wrapper (typed state accessors, step hook, name lookup)
    MujocoSim.ts
    types.ts
  render/           Three.js scene mirroring sim state
    Scene.ts
  control/          Typed kinematic control API (PD targets, stand, arm/elbow)
    HumanoidControl.ts
  agent/            LLM-facing surface
    tools.ts             JSON-schema tools + executeTool() dispatcher
    AgentClient.ts       Shared interface + runToolCalls() helper
    MockAgent.ts         Offline regex provider
    ClaudeAgent.ts       Anthropic Messages API + tool-use loop
    SpeechRecognizer.ts  (webkit)SpeechRecognition wrapper
    WebcamCapture.ts     getUserMedia + frame capture
  ui/               React panels
    ControlsPanel.tsx    Actuator sliders + command buttons + pause/reset
    ChatPanel.tsx        Transcript + mic + camera + provider settings
  App.tsx           Boots sim → scene → control → renders panels
  App.css           Layout + theming
  main.tsx          React root

public/
  assets/humanoid.xml    Vendored DeepMind humanoid MJCF
```

## Tool surface exposed to the LLM

All tools are intent-shaped so the model doesn't need to reason about MuJoCo internals.

| Tool          | Args                                       | Effect |
|---------------|--------------------------------------------|--------|
| `raise_arm`   | `side: "left"\|"right", angle_deg: number` | PD-targets both shoulder hinges of `side` to `angle_deg`. |
| `lower_arm`   | `side`                                     | Shoulder targets back to 0°. |
| `bend_elbow`  | `side, angle_deg`                          | PD-targets the elbow hinge. |
| `stand`       | `pin_root?: boolean`                       | All actuated joints PD-target their default angles. `pin_root` clamps the torso's free joint kinematically each step (won't fall but won't react to base forces). |
| `release_all` | —                                          | Drops every PD target and unpins the root. |

Dispatched via `src/agent/tools.ts::executeTool`. Results (`{ok, message}`) are streamed back as tool results so the model sees its own success/failure.

## Architecture decisions worth knowing

- **Z-up vs Y-up.** MuJoCo's world is Z-up. The rendered scene applies a single `rotateX(-π/2)` on the root `Group` so the parent transform handles the conversion and the per-geom matrix math stays a clean 1:1 copy of `geom_xmat`.
- **Three vs MuJoCo geom axes.** MuJoCo capsules and cylinders extend along local **Z**; Three.js capsule/cylinder geometries extend along local **Y**. The geom factory rotates those geometries 90° about X at build time so per-frame `geom_xmat` writes need no special-casing.
- **WebAssembly resolution under Vite.** `@mujoco/mujoco`'s ESM module resolves its `.wasm` via `new URL('mujoco.wasm', import.meta.url)`. Vite would relocate the JS during dep-optimization and break that relative URL, so the package is in `optimizeDeps.exclude`. `resolve.dedupe: ['three']` keeps the OrbitControls addon and the main `three` import on the same instance.
- **Step hook.** Higher-level controllers (the PD loop, future balance controller) register via `MujocoSim.setStepHook(fn)`. The sim calls every registered hook immediately before `mj_step`, so writes to `data.ctrl` / `data.qpos` take effect on the next integration.
- **Memory.** Embind-wrapped MuJoCo handles are not GC'd. Anything created in JS (`MjModel`, `MjData`, accessor returns) must be `.delete()`-ed. `MujocoSim.dispose()` and the various wrappers do that.

## Known limitations

- **No head joint** on the stock humanoid model. `turnHead` / `lookAt` deliberately throw `UnsupportedControlError` instead of silently no-oping. To enable them, swap in a Menagerie model with a neck (e.g. Unitree G1) and add the relevant actuator names to the control API.
- **No real walking.** `walk()` isn't implemented yet. The plan (per the project context doc) is a kinematic root translation while physics handles the limbs — a deliberate cheat that's fine for demos. A real bipedal gait would need an MPC controller or a pretrained policy ported via `onnxruntime-web`.
- **MuJoCo WASM is officially WIP.** Develop on macOS or Linux with Chrome — Windows builds of MuJoCo WASM are flaky as of 3.8.
- **Single-threaded physics.** This project uses the single-threaded MuJoCo build, so physics runs on the main thread. Fine for one humanoid. For multi-agent scenarios, switch to `@mujoco/mujoco/mt` and serve the right COOP/COEP headers.

## Commit history

The history is structured: one commit per logical layer (`feat(sim)`, `feat(render)`, `feat(control)`, `feat(agent)`, `feat(ui)`, `chore(vite)`). Use `git log --oneline` to walk the steps from scaffold to multimodal chat.

## License

MIT for the project code. The vendored `humanoid.xml` is © DeepMind under Apache 2.0 — see the header inside the file.
