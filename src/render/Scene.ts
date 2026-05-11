import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GeomType, type GeomTypeValue, type GeomDescriptor } from '../sim/types';
import type { MujocoSim } from '../sim/MujocoSim';
import { RENDER, SIM } from '../config';

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private meshes: THREE.Object3D[] = [];
  private sim: MujocoSim | null = null;
  private raf = 0;
  private rotMat = new THREE.Matrix4();
  private zUpToYUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  private root = new THREE.Group();
  paused = false;

  private followGetter: (() => [number, number, number] | null) | null = null;
  followEnabled = true;
  private followTmp = new THREE.Vector3();
  private followDelta = new THREE.Vector3();

  /** Wall-clock timestamp of the last RAF tick, used to drive a fixed-dt
   *  accumulator so the sim runs at MuJoCo's `model.opt.timestep` regardless
   *  of monitor refresh rate. */
  private lastTime = 0;
  private accum = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;

    this.scene.background = new THREE.Color(RENDER.fog.color);
    this.scene.fog = new THREE.Fog(RENDER.fog.color, RENDER.fog.near, RENDER.fog.far);

    this.camera = new THREE.PerspectiveCamera(RENDER.camera.fov, 1, RENDER.camera.near, RENDER.camera.far);
    this.camera.position.set(...RENDER.camera.position);
    this.camera.lookAt(...RENDER.camera.lookAt);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.55);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(4, 8, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    this.scene.add(this.root);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...RENDER.camera.lookAt);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 12;
    this.controls.update();

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  attachSim(sim: MujocoSim) {
    this.sim = sim;
    this.meshes.forEach(m => this.root.remove(m));
    this.meshes = sim.geoms.map(g => {
      const mesh = buildGeomMesh(g);
      // Set the auto-update flag once at attach time; the per-frame sync just
      // writes the matrix and trusts THREE to use it directly.
      mesh.matrixAutoUpdate = false;
      return mesh;
    });
    this.meshes.forEach(m => this.root.add(m));
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(this.zUpToYUp);
    this.syncFromSim();
  }

  setFollowGetter(fn: (() => [number, number, number] | null) | null) {
    this.followGetter = fn;
  }

  toggleFollow(enabled?: boolean) {
    this.followEnabled = enabled ?? !this.followEnabled;
  }

  start() {
    this.lastTime = performance.now();
    this.accum = 0;

    const tick = (now: number) => {
      const frame = Math.min((now - this.lastTime) / 1000, SIM.maxAccum);
      this.lastTime = now;

      if (this.sim && !this.paused) {
        const stepDt = this.sim.dt;
        this.accum += frame;
        let steps = 0;
        while (this.accum >= stepDt && steps < SIM.maxStepsPerFrame) {
          this.sim.step();
          this.accum -= stepDt;
          steps++;
        }
        // If we hit the per-frame step cap but still have leftover dt, drop
        // it instead of integrating it next frame — keeps the sim from
        // running away after a long stall.
        if (steps >= SIM.maxStepsPerFrame && this.accum > stepDt) {
          this.accum = 0;
        }
      }
      if (this.sim) this.syncFromSim();
      this.updateFollow();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private updateFollow() {
    if (!this.followEnabled || !this.followGetter) return;
    const mj = this.followGetter();
    if (!mj) return;
    // MuJoCo (x, y, z) → Three world (x, z, -y) via the Z-up→Y-up rotation
    // baked into the scene root. We apply it directly here so the camera —
    // which lives outside the rotated group — stays in world coordinates.
    this.followTmp.set(mj[0], mj[2], -mj[1]);
    this.followDelta.copy(this.followTmp).sub(this.controls.target);
    this.followDelta.multiplyScalar(RENDER.followLerp);
    this.controls.target.add(this.followDelta);
    this.camera.position.add(this.followDelta);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    window.removeEventListener('resize', this.handleResize);
    // Dispose GPU resources to keep dev StrictMode double-mounts from
    // accumulating WebGL contexts.
    for (const mesh of this.meshes) {
      if (mesh instanceof THREE.Mesh) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.meshes = [];
    this.renderer.dispose();
  }

  private syncFromSim() {
    if (!this.sim) return;
    const xpos = this.sim.geomXpos;
    const xmat = this.sim.geomXmat;
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      const p = i * 3;
      const r = i * 9;
      this.rotMat.set(
        xmat[r + 0], xmat[r + 1], xmat[r + 2], xpos[p + 0],
        xmat[r + 3], xmat[r + 4], xmat[r + 5], xpos[p + 1],
        xmat[r + 6], xmat[r + 7], xmat[r + 8], xpos[p + 2],
        0, 0, 0, 1,
      );
      m.matrix.copy(this.rotMat);
    }
  }

  private handleResize = () => {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

function buildGeomMesh(g: GeomDescriptor): THREE.Object3D {
  const color = new THREE.Color(g.rgba[0], g.rgba[1], g.rgba[2]);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.05,
    transparent: g.rgba[3] < 1,
    opacity: g.rgba[3],
  });
  const geometry = buildGeometry(g.type, g.size);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = g.type !== GeomType.PLANE;
  mesh.receiveShadow = true;
  return mesh;
}

function buildGeometry(type: GeomTypeValue, size: [number, number, number]): THREE.BufferGeometry {
  switch (type) {
    case GeomType.PLANE: {
      const x = size[0] > 0 ? size[0] * 2 : 20;
      const y = size[1] > 0 ? size[1] * 2 : 20;
      return new THREE.PlaneGeometry(x, y);
    }
    case GeomType.SPHERE:
      return new THREE.SphereGeometry(size[0], 24, 16);
    case GeomType.CAPSULE: {
      const g = new THREE.CapsuleGeometry(size[0], size[1] * 2, 8, 16);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case GeomType.ELLIPSOID: {
      const g = new THREE.SphereGeometry(1, 24, 16);
      g.scale(size[0], size[1], size[2]);
      return g;
    }
    case GeomType.CYLINDER: {
      const g = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 24);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case GeomType.BOX:
      return new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
    default:
      return new THREE.BoxGeometry(0.05, 0.05, 0.05);
  }
}
