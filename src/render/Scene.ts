import * as THREE from 'three';
import { GeomType, type GeomTypeValue, type GeomDescriptor } from '../sim/types';
import type { MujocoSim } from '../sim/MujocoSim';

export class Scene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private meshes: THREE.Object3D[] = [];
  private sim: MujocoSim | null = null;
  private raf = 0;
  private rotMat = new THREE.Matrix4();
  private zUpToYUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  private root = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;

    this.scene.background = new THREE.Color(0x111418);
    this.scene.fog = new THREE.Fog(0x111418, 8, 25);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    this.camera.position.set(3, 2.2, 3);
    this.camera.lookAt(0, 1, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.55);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(4, 8, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    this.scene.add(this.root);

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  attachSim(sim: MujocoSim) {
    this.sim = sim;
    this.meshes.forEach(m => this.root.remove(m));
    this.meshes = sim.geoms.map(buildGeomMesh);
    this.meshes.forEach(m => this.root.add(m));
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(this.zUpToYUp);
    this.syncFromSim();
  }

  start() {
    const tick = () => {
      if (this.sim) {
        for (let i = 0; i < 4; i++) this.sim.step();
        this.syncFromSim();
      }
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
  }

  private syncFromSim() {
    if (!this.sim) return;
    const xpos = this.sim.geomXpos;
    const xmat = this.sim.geomXmat;
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      const px = xpos[i * 3], py = xpos[i * 3 + 1], pz = xpos[i * 3 + 2];
      const r = xmat.subarray(i * 9, i * 9 + 9);
      this.rotMat.set(
        r[0], r[1], r[2], px,
        r[3], r[4], r[5], py,
        r[6], r[7], r[8], pz,
        0, 0, 0, 1,
      );
      m.matrixAutoUpdate = false;
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
      // Three capsule long axis = local Y. MuJoCo capsule long axis = local Z.
      // Rotate geometry so its long axis aligns with mesh local Z.
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
      // Same Y→Z axis swap as capsule.
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
