# Contributing

Thanks for picking up a humanoid sim ticket. This file maps the codebase so a
first PR doesn't need a tour.

## Layout

| Path                                | Owns                                                                 |
|-------------------------------------|----------------------------------------------------------------------|
| `src/sim/MujocoSim.ts`              | MuJoCo WASM lifecycle, typed Embind adapter, step hook contract.     |
| `src/sim/types.ts`                  | `mjtGeom` enum mirror + `GeomDescriptor` interface.                  |
| `src/render/Scene.ts`               | Three.js scene, geom factory, fixed-dt accumulator, camera follow.   |
| `src/control/HumanoidControl.ts`    | Typed kinematic API (PD, stand, walk, turn). Quaternion helpers.     |
| `src/agent/tools.ts`                | LLM-facing tool registry + dispatcher.                               |
| `src/agent/AgentClient.ts`          | Provider interface + tool-call helper.                               |
| `src/agent/MockAgent.ts`            | Offline regex provider.                                              |
| `src/agent/ClaudeAgent.ts`          | Anthropic Messages API client (tool-use loop, retry, prompt cache).  |
| `src/agent/SpeechRecognizer.ts`     | Web Speech API wrapper.                                              |
| `src/agent/WebcamCapture.ts`        | `getUserMedia` + JPEG frame capture.                                 |
| `src/ui/ChatPanel.tsx`              | Chat orchestrator. Composer / transcript / settings are subcomponents. |
| `src/ui/ControlsPanel.tsx`          | Per-actuator sliders + command buttons.                              |
| `src/ui/Toast.tsx`                  | App-level toast stack + `useToasts` hook.                            |
| `src/config.ts`                     | Every magic number that influences runtime behavior.                 |
| `public/assets/humanoid.xml`        | Vendored DeepMind MJCF model.                                        |

## Local checks

```bash
npm install
npm run dev         # http://localhost:5173
npm test            # vitest run (unit only)
npx tsc -b --noEmit # strict type-check
npx vite build      # prod build with chunking
```

The same four commands run in CI via `.github/workflows/ci.yml`.

## Style

- TypeScript everywhere. No `any` in new code — use the `TypedMjModel` /
  `TypedMjData` adapter in `MujocoSim.ts` as a precedent for boundary casts.
- Magic numbers go in `src/config.ts`. If you find yourself writing `0.12` or
  `768`, look there first.
- Errors at boundaries: control-layer throws `UnsupportedControlError`, agent
  layer catches and turns it into a `ToolResult`. Don't bubble raw `Error`
  into UI — use a toast.
- React state is for renderable values. Use `useRef` for object handles
  (`MujocoSim`, `Scene`, `HumanoidControl`).
- Commits: one logical change per commit. Conventional-Commits prefix
  (`feat(scope):`, `fix(scope):`, `chore(scope):`, `docs:`, `test:`). PRs that
  bundle unrelated work get split.

## Adding a new tool / command

1. Add a `register({ schema, handler })` block in `src/agent/tools.ts`.
2. Implement the handler against `HumanoidControl` — extend
   `HumanoidControl` if the primitive doesn't yet exist there.
3. Add a regex in `MockAgent.parseClause` so the offline mode works too.
4. Optional: surface a button in `ControlsPanel.tsx`.
5. Write a test in `tools.test.ts` and (if you added a regex)
   `MockAgent.test.ts`.

## Adding a new model

The codebase is humanoid-specific in two places only:

- `src/control/HumanoidControl.ts` hard-codes joint name patterns
  (`shoulder1_${side}`, `elbow_${side}`). New models need either renames
  in the MJCF or new wrappers.
- `public/assets/humanoid.xml` is the vendored MJCF.

Models without a free root joint will trip `UnsupportedControlError` from
`walk`/`turn`. Models without a head joint will trip
`UnsupportedControlError` from `turnHead`/`lookAt`. Both failures are by
design — the API is honest about what the underlying robot can do.

## Security / API keys

- The Anthropic key is stored in `localStorage` for ergonomic local dev. Don't
  share an URL with the key embedded; an XSS bug or malicious extension can
  read it.
- The `anthropic-dangerous-direct-browser-access: true` header is set
  intentionally; production deployments should swap `ClaudeAgent` for a
  server-proxied client.

## Tests

- `vitest` (jsdom env). Unit-only — anything that needs MuJoCo WASM lives in
  manual smoke flows.
- Stub `HumanoidControl` instead of standing up a real sim.

## Open invariants

- `MujocoSim` is the only owner of `mj_step`. Higher layers register hooks via
  `setStepHook`. No layer outside `sim/` should call into the MuJoCo module
  directly.
- `Scene` is the only owner of `requestAnimationFrame`. Other layers must not
  start their own RAF loops.
- `HumanoidControl` writes `data.ctrl` and may write the free-root `qpos`. No
  other layer should touch either.

## Deferred work

These are intentionally not shipped yet. Each entry documents what it is,
why it's deferred, and the cheapest path forward.

### Vendoring the Unitree G1 MJCF

A `UNITREE_G1_PROFILE` sketch lives in `src/control/humanoidProfiles.ts`
but the actual model isn't bundled. Wiring it requires:

1. Downloading the MJCF + ~30 mesh files (STL/OBJ) from
   [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_g1)
   under their open-source license.
2. Staging the assets under `public/assets/g1/` and pre-creating the
   matching directory tree on the Emscripten virtual FS at boot.
3. Verifying the joint names in `UNITREE_G1_PROFILE` against the shipping
   XML — Menagerie occasionally renames joints between MuJoCo versions.
4. Optionally enabling `hasHeadJoint` on the profile (G1 has a neck) and
   listing `headYawJoint` so `turnHead()` activates.

Path: a follow-up PR that vendors the asset bundle into `public/assets/`,
adds a model picker in `ControlsPanel`, and reuses the existing
profile-driven `HumanoidControl` plumbing.

### `lookAt(target)` inverse-kinematic solver

`HumanoidControl.lookAt()` is on the API surface for honest error
reporting but currently throws. A full implementation needs the head
joint (see G1 above) plus a one- or two-joint IK solve that points the
head's forward axis at the target world point. With a single-yaw neck
the math is trivial (atan2 of target-minus-head xy); with yaw+pitch it's
a 2-DOF spherical solve.

### Model Context Protocol (MCP) server wrap

Project doc step 8. Only useful when the browser app is being driven by
an external MCP host (Claude Desktop, Cline, etc.). The path is:

- Create a `mcp-server/` Node package using `@modelcontextprotocol/sdk`.
- Re-export the same tools registered in `src/agent/tools.ts` from the
  Node side.
- Tunnel tool dispatch back to the browser via WebSocket so the
  control writes hit the real `HumanoidControl` instance.

The current direct-LLM and server-proxy paths cover every standalone
use case, so MCP is parked until a concrete external-host scenario
shows up.

### WebGPU renderer

Three.js supports WebGPU via `three/webgpu`'s `WebGPURenderer`, but
migration isn't a drop-in: every material class (`MeshStandardMaterial`,
etc.) needs its `*NodeMaterial` counterpart and the render loop becomes
async-aware. The current WebGL2 path is fast enough for one humanoid
that the migration's complexity outweighs the win. Revisit when there's
a concrete perf complaint or a feature (compute shaders, raymarching)
that WebGPU enables.

### Stricter ESLint rules

`tseslint.configs.strictTypeChecked` would catch additional unsoundness
(unsafe assignments, `any` flow, floating promises). It's not enabled
yet because `eslint.config.js` is guarded by the repo's
config-protection hook, which blocks even legitimate strengthening
edits. Document the policy, disable the hook explicitly, or migrate the
extra rules into a sibling config that the hook permits.
