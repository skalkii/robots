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
