// three.js step viewer for any brick model produced by engine.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS, PARTS } from './palette.js';

const PH = 0.4; // plate height in stud units

export function createViewer(host, model, opts = {}) {
  const { W, pieces, steps } = model;
  const sx = v => v - W / 2 + 0.5;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';

  const scene = new THREE.Scene();
  if (opts.background) scene.background = new THREE.Color(opts.background);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 6; controls.maxDistance = 600;
  if (opts.showcase) { controls.enableZoom = false; controls.enablePan = false; }

  const topY = (pieces.reduce((m, p) => Math.max(m, p.z + PARTS[p.part].h), 0)) * PH;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xB8C4D0, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(W * 1.2, topY + 80, W * 1.6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const ext = Math.max(W, topY) * 0.75;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 800 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xDDE8FF, 0.7); fill.position.set(-80, 40, -60); scene.add(fill);

  const col3 = key => new THREE.Color(COLORS[key].hex);
  const matOpaque = new THREE.MeshStandardMaterial({ roughness: 0.42 });
  const matTrans = new THREE.MeshStandardMaterial({ roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false });

  // baseplate
  {
    const bp = model.baseplate, n = bp.size;
    const m = new THREE.Mesh(new THREE.BoxGeometry(n, 0.13, n), new THREE.MeshStandardMaterial({ color: col3(bp.color), roughness: 0.6 }));
    m.position.y = -0.065; m.receiveShadow = true; scene.add(m);
    const studs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.17, 14), m.material, n * n);
    const M = new THREE.Matrix4(); let k = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { M.makeTranslation(i - n / 2 + 0.5, 0.085, j - n / 2 + 0.5); studs.setMatrixAt(k++, M); }
    studs.receiveShadow = true; scene.add(studs);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(n * 2.5, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = -0.14; disc.receiveShadow = true; scene.add(disc);
  }

  // instanced parts, filled in step order so `mesh.count` reveals the build so far
  // 45° slope: runs downhill along local +x over 2 studs, unit width along z, base at y=0
  const slopeGeo = (() => {
    const H3 = 3 * PH - 0.012, sh = new THREE.Shape();
    sh.moveTo(-1, 0); sh.lineTo(1, 0); sh.lineTo(1, 0.2); sh.lineTo(0, H3); sh.lineTo(-1, H3); sh.lineTo(-1, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5); g.computeVertexNormals();
    return g;
  })();
  const GEO = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20), stud: new THREE.CylinderGeometry(0.3, 0.3, 0.17, 12), slope: slopeGeo };
  const ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2], yAxis = new THREE.Vector3(0, 1, 0);
  const q0 = new THREE.Quaternion(), vS = new THREE.Vector3(), vP = new THREE.Vector3();
  const pieceGeom = pieces.map(p => {
    const def = PARTS[p.part], trans = !!COLORS[p.color].trans, color = col3(p.color), tag = trans ? 'T' : 'O';
    const y0 = p.z * PH, h = def.h * PH, cx = sx(p.x), cz = sx(p.y), list = [];
    const emit = (name, geo, px, py, pz, a, b, c, q = q0) => list.push({ name: name + tag, geo, trans, color, m: new THREE.Matrix4().compose(vP.set(px, py, pz), q, vS.set(a, b, c)) });
    if (def.shape === 'round') emit('cyl', GEO.cyl, cx, y0 + h / 2, cz, def.w - 0.04, h - 0.01, def.d - 0.04);
    else if (def.shape === 'slope') emit('slope', GEO.slope, cx, y0, cz, 0.98, 1, def.d - 0.04, new THREE.Quaternion().setFromAxisAngle(yAxis, ROT[p.rot || 0]));
    else emit('box', GEO.box, cx, y0 + h / 2, cz, p.w - 0.04, h - 0.012, p.d - 0.04);
    if (def.studs === false) return list;
    const studAt = def.shape === 'slope' ? p.high : def.shape === 'jumper' || p.cells.length === 0 ? [[p.x, p.y]] : p.cells;
    for (const [i, j] of studAt) emit('stud', GEO.stud, sx(i), y0 + h + 0.085, sx(j), 1, 1, 1);
    return list;
  });
  const buckets = {};
  for (const s of steps) for (const k of s.pieces) for (const e of pieceGeom[k]) {
    const b = buckets[e.name] || (buckets[e.name] = { geo: e.geo, trans: e.trans, mats: [], cols: [], cum: new Int32Array(steps.length + 1) });
    b.mats.push(e.m); b.cols.push(e.color);
  }
  { const counts = {};
    steps.forEach((s, si) => {
      for (const k of s.pieces) for (const e of pieceGeom[k]) counts[e.name] = (counts[e.name] || 0) + 1;
      for (const [name, b] of Object.entries(buckets)) b.cum[si + 1] = counts[name] || 0;
    }); }
  for (const b of Object.values(buckets)) {
    const mesh = new THREE.InstancedMesh(b.geo, b.trans ? matTrans : matOpaque, b.mats.length);
    b.mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, b.cols[i]); });
    mesh.castShadow = !b.trans; mesh.receiveShadow = true;
    b.mesh = mesh; scene.add(mesh);
  }

  const hiGroup = new THREE.Group(); scene.add(hiGroup);
  const edgeBox = new THREE.EdgesGeometry(GEO.box), edgeCyl = new THREE.EdgesGeometry(GEO.cyl, 40), edgeSlope = new THREE.EdgesGeometry(GEO.slope);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85 });
  let hiMats = [];

  // per-layer horizontal extent, for camera framing
  const layerExt = new Float32Array(model.H + 4);
  for (const p of pieces) {
    const e = p.cells.length ? Math.max(...p.cells.map(([i, j]) => Math.max(Math.abs(sx(i)), Math.abs(sx(j))) + 0.5)) : 1;
    for (let dz = 0; dz < PARTS[p.part].h; dz++) layerExt[p.z + dz] = Math.max(layerExt[p.z + dz], e);
  }

  function show(si, full = false) {
    const upto = full ? steps.length : si;
    for (const b of Object.values(buckets)) b.mesh.count = b.cum[upto];
    hiGroup.clear(); hiMats.forEach(m => m.dispose()); hiMats = [];
    if (full) return;
    for (const k of steps[si].pieces) for (const e of pieceGeom[k]) {
      const mat = new THREE.MeshStandardMaterial({ color: e.color, roughness: 0.4, transparent: e.trans, opacity: e.trans ? 0.6 : 1, emissive: 0xFFB000, emissiveIntensity: 0 });
      hiMats.push(mat);
      const mesh = new THREE.Mesh(e.geo, mat); mesh.applyMatrix4(e.m); mesh.castShadow = true; hiGroup.add(mesh);
      if (!e.name.startsWith('stud')) { const ln = new THREE.LineSegments(e.name.startsWith('box') ? edgeBox : e.name.startsWith('slope') ? edgeSlope : edgeCyl, edgeMat); ln.applyMatrix4(e.m); hiGroup.add(ln); }
    }
  }

  // camera
  const goal = { target: new THREE.Vector3(), dist: 100, azimuth: null, active: false };
  let follow = true, spin = !!opts.showcase;
  function frame(si, instant = false) {
    const s = steps[si];
    if (!s.layers.length) { goal.target.set(0, 0, 0); goal.dist = Math.max(30, W * 1.9); goal.azimuth = null; }
    else {
      const z0 = s.layers[0], z1 = s.layers[s.layers.length - 1];
      let e = 2.5; for (let z = z0; z <= z1; z++) e = Math.max(e, layerExt[z]);
      goal.target.set(0, (z1 + 1) * PH - 1, 0);
      goal.dist = Math.max(30, e * 5 + 22);
      if (s.quadrant) { const p = pieces[s.pieces[0]]; goal.azimuth = Math.atan2(sx(p.y), sx(p.x)); } else goal.azimuth = null;
    }
    goal.active = true;
    if (instant) apply(1);
  }
  function apply(t) {
    controls.target.lerp(goal.target, t);
    const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    sph.radius += (goal.dist - sph.radius) * t;
    sph.phi += (THREE.MathUtils.degToRad(62) - sph.phi) * t * 0.5;
    if (goal.azimuth != null) { let d = goal.azimuth - sph.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); sph.theta += d * t * 0.6; }
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
  }
  function overview() {
    // fit the whole model (height and baseplate) in view
    const fov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const fitH = (topY / 2 + 2) / Math.tan(fov), fitW = (W * 0.75) / (Math.tan(fov) * Math.max(0.6, camera.aspect));
    const dist = Math.max(fitH, fitW) * 1.12;
    controls.target.set(0, topY * 0.4, 0);
    camera.position.copy(controls.target).add(new THREE.Vector3(0.52, 0.22, 0.82).normalize().multiplyScalar(dist));
    goal.active = false;
  }
  controls.addEventListener('start', () => { goal.active = false; });

  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();

  const clock = new THREE.Clock(); let raf = 0, visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(host);
  function tick() {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    if (goal.active && follow) { apply(Math.min(1, dt * 4)); if (controls.target.distanceTo(goal.target) < 0.05) goal.active = false; }
    if (spin) { const off = camera.position.clone().sub(controls.target); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.2); camera.position.copy(controls.target).add(off); }
    const pulse = 0.18 + 0.18 * Math.sin(t * 4); for (const m of hiMats) m.emissiveIntensity = pulse;
    controls.update(); renderer.render(scene, camera);
  }
  camera.position.set(60, 60, 90);
  tick();

  return {
    show, frame, overview,
    setFollow(v) { follow = v; if (v && opts.current) frame(opts.current()); },
    setSpin(v) { spin = v; },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.85); },
    // camera on a sphere around the whole model: theta from +z toward +x, phi = elevation
    shot(theta, phi) {
      overview();
      const dist = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.sin(phi), Math.cos(theta) * Math.cos(phi)).multiplyScalar(dist));
      camera.lookAt(controls.target);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/jpeg', 0.82);
    },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); host.removeChild(renderer.domElement); },
  };
}

// front / right side / 3/4 renders of a finished model, as base64 JPEGs (for the AI refinement pass)
export async function renderViews(model, size = 640) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${size * 3}px;top:0;width:${size}px;height:${size}px;background:#fff`;
  document.body.appendChild(host);
  const v = createViewer(host, model, { background: '#ffffff' });
  v.setSpin(false); v.setFollow(false);
  v.show(model.steps.length - 1, true);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const shots = [v.shot(0, 0.12), v.shot(Math.PI / 2, 0.12), v.shot(-Math.PI / 4, 0.45)].map(u => u.split(',')[1]);
  v.dispose(); host.remove();
  return shots;
}
