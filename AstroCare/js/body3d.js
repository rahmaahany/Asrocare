/* AstroCare — holographic 3D body (three.js). Exposes window.Body3D.create(). */
(function () {
  'use strict';

  var ANCHOR = {
    brain: [0, 1.745, 0.05], eyes: [0.045, 1.66, 0.1], lungs: [-0.085, 1.33, 0.07], heart: [0.035, 1.255, 0.1],
    core: [0, 1.06, 0.1], muscle: [-0.115, 0.7, 0.075], shell: [0.135, 0.3, 0.06]
  };

  var VERT = [
    'varying vec3 vN; varying vec3 vV; varying float vY;',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position,1.0); vY = wp.y;',
    '  vec4 mv = viewMatrix * wp;',
    '  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var FRAG = [
    'uniform vec3 uColor; uniform vec3 uScanColor; uniform float uRim; uniform float uBase; uniform float uPow;',
    'uniform float uOpacity; uniform float uScan; uniform float uTime; uniform float uLines;',
    'varying vec3 vN; varying vec3 vV; varying float vY;',
    'void main(){',
    '  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);',
    '  float scan = smoothstep(0.035, 0.0, abs(vY - uScan));',
    '  float lines = uLines * smoothstep(0.85, 1.0, fract(vY * 60.0 - uTime * 0.6));',
    '  float a = f * uRim + uBase + lines * (0.3 + f);',
    '  vec3 col = uColor * a + uScanColor * scan * 1.2;',
    '  gl_FragColor = vec4(col, (a + scan * 0.8) * uOpacity);',
    '}'
  ].join('\n');

  function create(container, hsLayer, opts) {
    var api = { ok: false };
    if (!window.THREE) return api;
    var T = window.THREE, renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { return api; }
    if (!renderer.getContext()) return api;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    container.insertBefore(renderer.domElement, container.firstChild);

    var C = {};
    Object.keys(opts.colors).forEach(function (k) { C[k] = new T.Color(opts.colors[k] || '#35C6E8'); });
    var LV = { green: C.green, yellow: C.yellow, red: C.red };

    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(28, 1, 0.1, 50);
    var target = new T.Vector3(0, 0.95, 0);
    var BASE_DIST = 5.0;
    camera.position.set(0, 1.05, BASE_DIST);
    camera.lookAt(target);

    var root = new T.Group(); scene.add(root);
    var body = new T.Group(); root.add(body);
    var time = { value: 0 }, scanU = { value: 0 };

    function holo(color, o) {
      o = o || {};
      return new T.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
        blending: T.AdditiveBlending, side: o.side || T.FrontSide,
        uniforms: {
          uColor: { value: color.clone() }, uScanColor: { value: C.glow.clone() },
          uRim: { value: o.rim != null ? o.rim : 1.1 }, uBase: { value: o.base != null ? o.base : 0.04 },
          uPow: { value: o.pow || 2.2 }, uOpacity: { value: o.opacity != null ? o.opacity : 1 },
          uLines: { value: o.lines || 0 }, uScan: scanU, uTime: time
        }
      });
    }
    var up = new T.Vector3(0, 1, 0);
    function limb(a, b, r, mat, group) {
      var A = new T.Vector3().fromArray(a), B = new T.Vector3().fromArray(b), d = B.clone().sub(A), len = d.length();
      var m = new T.Mesh(new T.CapsuleGeometry(r, Math.max(0.001, len), 8, 20), mat);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, d.normalize());
      (group || body).add(m); return m;
    }
    function blob(pos, scale, r, mat, group, detail) {
      var m = new T.Mesh(new T.IcosahedronGeometry(r, detail || 4), mat);
      m.position.fromArray(pos); m.scale.fromArray(scale);
      (group || body).add(m); return m;
    }

    /* ---------- skin shell ---------- */
    var shellMat = holo(C.cyan, { rim: 1.25, base: 0.035, pow: 2.4, lines: 0.12 });
    var wireMat = new T.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.045, blending: T.AdditiveBlending, depthWrite: false });
    var shell = new T.Group(); body.add(shell);
    var torsoPts = [[0, 0.86], [0.11, 0.875], [0.165, 0.93], [0.17, 1.0], [0.15, 1.08], [0.142, 1.13], [0.152, 1.2], [0.172, 1.29], [0.19, 1.37], [0.195, 1.42], [0.165, 1.465], [0.09, 1.49], [0.05, 1.5], [0, 1.505]]
      .map(function (p) { return new T.Vector2(p[0], p[1]); });
    var torso = new T.Mesh(new T.LatheGeometry(torsoPts, 48), shellMat);
    torso.scale.set(1, 1, 0.6); shell.add(torso);
    var head = blob([0, 1.665, 0.005], [0.88, 1.12, 1], 0.105, shellMat, shell);
    limb([0, 1.47, 0], [0, 1.58, 0.005], 0.048, shellMat, shell);
    var S = [
      [[0.205, 1.405, 0], [0.275, 1.13, 0.0], 0.05], [[0.275, 1.13, 0], [0.325, 0.87, 0.03], 0.04],
      [[0.09, 0.9, 0], [0.105, 0.49, 0.01], 0.078], [[0.105, 0.47, 0.01], [0.11, 0.085, -0.005], 0.055],
      [[0.11, 0.04, -0.02], [0.115, 0.04, 0.13], 0.036]
    ];
    [1, -1].forEach(function (sx) {
      S.forEach(function (s) { limb([s[0][0] * sx, s[0][1], s[0][2]], [s[1][0] * sx, s[1][1], s[1][2]], s[2], shellMat, shell); });
      blob([0.2 * sx, 1.4, 0], [1, 1, 1], 0.066, shellMat, shell, 3);
      blob([0.338 * sx, 0.79, 0.035], [0.55, 1.15, 0.32], 0.065, shellMat, shell, 3);
    });
    shell.children.slice().forEach(function (m) {
      var w = new T.Mesh(m.geometry, wireMat); w.position.copy(m.position); w.quaternion.copy(m.quaternion); w.scale.copy(m.scale); shell.add(w);
    });

    /* ---------- skeleton (decorative) ---------- */
    var boneMat = holo(C.cyan, { rim: 0.6, base: 0.12, pow: 1.5, opacity: 0.55 });
    var skel = new T.Group(); body.add(skel);
    for (var vy = 0.98; vy < 1.56; vy += 0.032) {
      var v = new T.Mesh(new T.BoxGeometry(0.03, 0.018, 0.026), boneMat); v.position.set(0, vy, -0.055); skel.add(v);
    }
    for (var ri = 0; ri < 7; ri++) {
      var rib = new T.Mesh(new T.TorusGeometry(0.135 - Math.abs(ri - 2.5) * 0.008, 0.005, 6, 40, Math.PI * 1.55), boneMat);
      rib.rotation.set(Math.PI / 2 + 0.25, 0, -Math.PI * 0.275 - Math.PI / 2 + Math.PI);
      rib.scale.set(1, 0.62, 1); rib.position.set(0, 1.39 - ri * 0.04, -0.005); skel.add(rib);
    }
    var pelvis = new T.Mesh(new T.TorusGeometry(0.1, 0.014, 8, 40), boneMat);
    pelvis.rotation.x = Math.PI / 2 - 0.35; pelvis.scale.set(1.15, 0.75, 1); pelvis.position.set(0, 0.93, 0); skel.add(pelvis);
    blob([0, 1.665, 0], [0.8, 0.95, 0.9], 0.095, boneMat, skel, 3);
    [1, -1].forEach(function (sx) {
      limb([0.095 * sx, 0.88, 0], [0.105 * sx, 0.5, 0.01], 0.012, boneMat, skel);
      limb([0.105 * sx, 0.46, 0.01], [0.11 * sx, 0.1, -0.005], 0.01, boneMat, skel);
      limb([0.21 * sx, 1.38, 0], [0.275 * sx, 1.14, 0], 0.01, boneMat, skel);
      limb([0.275 * sx, 1.12, 0], [0.325 * sx, 0.89, 0.03], 0.008, boneMat, skel);
      limb([0.03 * sx, 1.45, 0.02], [0.19 * sx, 1.43, 0], 0.008, boneMat, skel);
      blob([0.105 * sx, 0.48, 0.03], [1, 0.8, 0.7], 0.022, boneMat, skel, 2);
    });

    /* ---------- organs (each tied to a monitored metric) ---------- */
    var organs = {};
    function organ(name) {
      var g = new T.Group(); g.userData.organ = name; body.add(g);
      var mat = holo(C.green, { rim: 1.4, base: 0.2, pow: 1.6, opacity: 0.85 });
      organs[name] = { group: g, mat: mat, level: 'green', parts: [] };
      return organs[name];
    }
    function add(o, mesh) { mesh.userData.organ = o.group.userData.organ; o.parts.push(mesh); return mesh; }

    var brain = organ('brain');
    var bg = new T.IcosahedronGeometry(0.075, 5), bp = bg.attributes.position, tv = new T.Vector3();
    for (var i = 0; i < bp.count; i++) {
      tv.fromBufferAttribute(bp, i);
      var n = Math.sin(tv.x * 120) * Math.sin(tv.y * 110 + tv.z * 60) * 0.06 + Math.sin(tv.z * 90) * 0.03;
      tv.multiplyScalar(1 + n); if (Math.abs(tv.x) < 0.006) tv.multiplyScalar(0.93);
      bp.setXYZ(i, tv.x, tv.y, tv.z);
    }
    bg.computeVertexNormals();
    add(brain, blob([0, 1.705, -0.005], [0.95, 0.75, 1.15], 1, brain.mat, brain.group)).geometry = bg;

    var eyes = organ('eyes');
    [1, -1].forEach(function (sx) { add(eyes, blob([0.036 * sx, 1.655, 0.082], [1, 0.8, 0.7], 0.015, eyes.mat, eyes.group, 2)); });

    var lungs = organ('lungs');
    [1, -1].forEach(function (sx) {
      var l = add(lungs, blob([0.072 * sx, 1.31, 0.0], [0.78, 1.5, 0.8], 0.068, lungs.mat, lungs.group, 4));
      l.rotation.z = -0.12 * sx;
    });
    add(lungs, limb([0, 1.47, 0.0], [0, 1.39, 0.0], 0.01, lungs.mat, lungs.group));

    var heart = organ('heart');
    var hm = add(heart, blob([0.028, 1.255, 0.05], [1, 1.2, 0.9], 0.045, heart.mat, heart.group, 4));
    hm.rotation.z = -0.5;
    add(heart, limb([0.02, 1.29, 0.04], [0.01, 1.36, 0.02], 0.012, heart.mat, heart.group));

    var core = organ('core');
    add(core, blob([0, 1.06, 0.02], [1.25, 0.7, 0.7], 0.085, core.mat, core.group, 4));
    add(core, blob([-0.07, 1.14, 0.03], [1.1, 0.6, 0.7], 0.05, core.mat, core.group, 3));

    var muscle = organ('muscle');
    muscle.mat.uniforms.uOpacity.value = 0.5;
    [1, -1].forEach(function (sx) {
      add(muscle, limb([0.095 * sx, 0.83, 0.02], [0.105 * sx, 0.56, 0.025], 0.062, muscle.mat, muscle.group));
      add(muscle, limb([0.107 * sx, 0.4, -0.005], [0.11 * sx, 0.2, -0.015], 0.045, muscle.mat, muscle.group));
      add(muscle, limb([0.225 * sx, 1.34, 0.01], [0.265 * sx, 1.17, 0.01], 0.04, muscle.mat, muscle.group));
    });

    /* whole-body (radiation) uses the skin shell */
    organs.shell = { group: shell, mat: shellMat, level: 'green', parts: [torso], shell: true };
    shell.children.forEach(function (m) { if (m.material === shellMat) { m.userData.organ = 'shell'; organs.shell.parts.push(m); } });

    /* ---------- platform, beam, scan ring, particles ---------- */
    var deco = new T.Group(); root.add(deco);
    function ringMesh(r1, r2, op, segs, start, len) {
      var m = new T.Mesh(new T.RingGeometry(r1, r2, segs || 96, 1, start || 0, len || Math.PI * 2),
        new T.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2; deco.add(m); return m;
    }
    ringMesh(0.46, 0.475, 0.7); ringMesh(0.58, 0.585, 0.35); ringMesh(0.0, 0.46, 0.06);
    var dashes = new T.Group(); deco.add(dashes);
    for (var di = 0; di < 36; di++) {
      var dm = ringMesh(0.5, 0.54, 0.45, 4, di / 36 * Math.PI * 2, Math.PI * 2 / 36 * 0.55);
      deco.remove(dm); dashes.add(dm);
    }
    var outerArc = new T.Group(); deco.add(outerArc);
    [0, 2.1, 4.2].forEach(function (s) { var m = ringMesh(0.64, 0.655, 0.6, 32, s, 1.2); deco.remove(m); outerArc.add(m); });

    var beamMat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { uColor: { value: C.cyan.clone() }, uTime: time },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.5) * 0.16; a *= 0.75 + 0.25 * sin(vUv.x * 60.0 + uTime * 2.0); gl_FragColor = vec4(uColor * a, a); }'
    });
    var beam = new T.Mesh(new T.CylinderGeometry(0.46, 0.46, 2.1, 64, 1, true), beamMat);
    beam.position.y = 1.05; deco.add(beam);

    var scanRing = new T.Mesh(new T.TorusGeometry(0.42, 0.004, 8, 96),
      new T.MeshBasicMaterial({ color: C.glow, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }));
    scanRing.rotation.x = Math.PI / 2; scanRing.scale.set(1, 0.55, 1); deco.add(scanRing);

    var PN = 260, pg = new T.BufferGeometry(), pa = new Float32Array(PN * 3), ps = [];
    for (var pi = 0; pi < PN; pi++) {
      var ang = Math.random() * Math.PI * 2, rad = 0.15 + Math.random() * 0.55;
      pa[pi * 3] = Math.cos(ang) * rad; pa[pi * 3 + 1] = Math.random() * 2.1; pa[pi * 3 + 2] = Math.sin(ang) * rad;
      ps.push(0.05 + Math.random() * 0.15);
    }
    pg.setAttribute('position', new T.BufferAttribute(pa, 3));
    var dots = new T.Points(pg, new T.PointsMaterial({ color: C.cyan, size: 0.012, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false }));
    deco.add(dots);

    /* ---------- hotspots ---------- */
    var spots = {}, anchors = {};
    opts.parts.forEach(function (p, idx) {
      var key = organs[p.organ] ? p.organ : 'shell';
      var a = (ANCHOR[key] || ANCHOR.shell).slice();
      if (!ANCHOR[p.organ]) a[1] += idx * 0.02;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'hs';
      btn.setAttribute('data-hs', p.id); btn.setAttribute('aria-label', p.name);
      btn.addEventListener('click', function () { opts.onPick(p.id); });
      btn.addEventListener('mouseenter', function () { opts.onHover(p.id); });
      hsLayer.appendChild(btn);
      spots[p.id] = { el: btn, local: new T.Vector3().fromArray(a), organ: key };
      if (!organs[key].partId) organs[key].partId = p.id;
    });

    /* ---------- interaction ---------- */
    var canvas = renderer.domElement, rotY = 0.35, rotX = 0, velY = 0, autoOn = true, lastInput = 0;
    var dragging = false, moved = 0, px = 0, py = 0, zoom = 1, selected = null, hoverId = null;
    var ray = new T.Raycaster(), mouse = new T.Vector2(), pickables = [];
    Object.keys(organs).forEach(function (k) { organs[k].parts.forEach(function (m) { pickables.push(m); }); });

    function pick(e) {
      var r = canvas.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      var hits = ray.intersectObjects(pickables, false);
      var best = null;
      for (var h = 0; h < hits.length; h++) {
        var o = hits[h].object.userData.organ;
        if (o !== 'shell') { best = o; break; }
        if (!best) best = o;
      }
      return best && organs[best].partId ? organs[best].partId : null;
    }
    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; moved = 0; px = e.clientX; py = e.clientY; velY = 0;
      canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (dragging) {
        var dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        rotY += dx * 0.01; velY = dx * 0.01; rotX = Math.max(-0.35, Math.min(0.35, rotX + dy * 0.004));
        lastInput = performance.now();
        return;
      }
      var id = pick(e);
      canvas.classList.toggle('pick', !!id);
      if (id) lastInput = performance.now();
      if (id && id !== hoverId) opts.onHover(id);
      hoverId = id;
    });
    function end(e) {
      if (!dragging) return;
      dragging = false; canvas.classList.remove('dragging');
      if (moved < 5) { var id = pick(e); if (id) opts.onPick(id); }
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', function () { hoverId = null; canvas.classList.remove('pick'); });
    canvas.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.altKey) return;
      e.preventDefault(); zoom = Math.max(0.7, Math.min(1.5, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { api.reset(); });

    /* ---------- sizing + loop ---------- */
    var W = 0, H = 0, active = false, raf = 0, hr = 72, beatT = 0, last = performance.now();
    function resize() {
      W = container.clientWidth; H = container.clientHeight;
      if (W < 2 || H < 2) return;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      var needH = 2.25, needW = 1.35;
      var distH = needH / 2 / Math.tan(T.MathUtils.degToRad(camera.fov / 2));
      var distW = needW / 2 / Math.tan(T.MathUtils.degToRad(camera.fov / 2)) / camera.aspect;
      BASE_DIST = Math.max(distH, distW);
      camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
    window.addEventListener('resize', resize);

    var tmp = new T.Vector3(), camDir = new T.Vector3(), c3 = new T.Color();
    function frame(now) {
      raf = 0;
      if (!active) return;
      var dt = Math.min((now - last) / 1000, 0.05); last = now;
      time.value += dt;
      if (!dragging) {
        rotY += velY; velY *= 0.92;
        if (autoOn && now - lastInput > 2500) rotY += dt * 0.35;
      }
      root.rotation.y = rotY;
      var dist = BASE_DIST / zoom;
      camera.position.set(0, target.y + Math.sin(rotX) * dist, Math.cos(rotX) * dist);
      camera.lookAt(target);

      scanU.value = 0.05 + (Math.sin(time.value * 0.7) * 0.5 + 0.5) * 1.75;
      scanRing.position.y = scanU.value;
      dashes.rotation.y = time.value * 0.4; outerArc.rotation.y = -time.value * 0.25;
      var arr = pg.attributes.position.array;
      for (var i = 0; i < PN; i++) { arr[i * 3 + 1] += ps[i] * dt; if (arr[i * 3 + 1] > 2.1) arr[i * 3 + 1] = 0; }
      pg.attributes.position.needsUpdate = true;

      beatT += dt * hr / 60;
      var ph = beatT % 1, beat = Math.exp(-Math.pow((ph - 0.08) / 0.05, 2)) + 0.5 * Math.exp(-Math.pow((ph - 0.28) / 0.06, 2));
      heart.group.children[0].scale.set(1 + beat * 0.12, 1.2 * (1 + beat * 0.12), 0.9 * (1 + beat * 0.12));
      var breath = Math.sin(time.value * 1.6) * 0.04;
      lungs.parts.forEach(function (m, k) { if (k < 2) m.scale.set(0.78 * (1 + breath), 1.5 * (1 + breath * 0.6), 0.8 * (1 + breath)); });

      Object.keys(organs).forEach(function (k) {
        var o = organs[k], isSel = o.partId && o.partId === selected;
        var pulse = 0.5 + 0.5 * Math.sin(time.value * (o.level === 'red' ? 9 : 4));
        var u = o.mat.uniforms;
        if (o.shell) {
          c3.copy(o.level === 'green' ? C.cyan : LV[o.level]);
          u.uColor.value.lerp(c3, 0.1);
          u.uRim.value = isSel ? 1.8 + pulse * 0.5 : (o.level === 'red' ? 1.3 + pulse * 0.6 : 1.25);
        } else {
          u.uColor.value.lerp(LV[o.level], 0.1);
          u.uBase.value = isSel ? 0.55 + pulse * 0.35 : (o.level === 'red' ? 0.25 + pulse * 0.4 : 0.2);
          u.uRim.value = isSel ? 2.2 : 1.4;
        }
      });

      renderer.render(scene, camera);

      camera.getWorldDirection(camDir);
      Object.keys(spots).forEach(function (id) {
        var s = spots[id];
        tmp.copy(s.local).applyMatrix4(body.matrixWorld);
        var depth = tmp.clone().sub(camera.position).dot(camDir);
        var front = tmp.clone().setY(0).applyAxisAngle(up, 0).dot(new T.Vector3(camera.position.x, 0, camera.position.z).normalize()) > -0.02;
        tmp.project(camera);
        var x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
        anchors[id] = { x: x, y: y, front: front, depth: depth };
        s.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        s.el.classList.toggle('back', !front);
      });
      if (opts.onFrame) opts.onFrame();
      raf = requestAnimationFrame(frame);
    }

    api.ok = true;
    api.anchors = function () { return anchors; };
    api.setActive = function (on) {
      active = on;
      if (on) { resize(); last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); }
    };
    api.setAutoRotate = function (on) { autoOn = on; };
    api.hold = function () { lastInput = performance.now(); };
    api.reset = function () { rotY = 0.35; rotX = 0; velY = 0; zoom = 1; lastInput = 0; };
    api.setHeartRate = function (b) { hr = b || 72; };
    api.setLevel = function (id, level) {
      var s = spots[id]; if (!s) return;
      organs[s.organ].level = level;
      s.el.classList.toggle('yellow', level === 'yellow');
      s.el.classList.toggle('red', level === 'red');
    };
    api.select = function (id) {
      selected = id;
      Object.keys(spots).forEach(function (k) { spots[k].el.classList.toggle('on', k === id); });
    };
    resize();
    return api;
  }

  window.Body3D = { create: create };
})();
