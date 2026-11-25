"""Builds cinematic.html from throne.html: the same throne, plus a timed sequence (crown lifts out of the throne, flies to
the centre, turns slowly) and the win text centred under it. Valorant (cine=val): red and off-white with angular red
shards. Mobile Legends (cine=ml): gold with rising sparks. frameAt(t) renders time t, so render_cine.mjs can export it."""
from pathlib import Path
HERE = Path(__file__).parent
s = (HERE / "throne.html").read_text(encoding="utf-8")
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)

rep('composer.addPass(new BokehPass(scene, camera, { focus: 7.6, aperture: 0.0018, maxblur: 0.006 }));',
    'const bokeh = new BokehPass(scene, camera, { focus: 7.6, aperture: 0.0018, maxblur: 0.006 }); composer.addPass(bokeh);')
rep('<style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>', '''<style>
html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}
.ov{position:absolute;inset:0;pointer-events:none;font-family:"Bahnschrift","Segoe UI",sans-serif;color:#fff}
.bar{position:absolute;left:0;right:0;height:84px;background:#05020a}
.txt{position:absolute;left:0;right:0;top:640px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}
.k{font-size:30px;letter-spacing:.14em;text-transform:uppercase}
.n{font-weight:700;font-stretch:condensed;font-size:150px;line-height:.95;text-transform:uppercase;letter-spacing:.01em;white-space:nowrap;text-shadow:0 6px 24px rgba(0,0,0,.6)}
.x{margin-top:14px;padding:8px 34px 6px;font-weight:700;font-size:56px;letter-spacing:.04em;color:#fff;clip-path:polygon(18px 0,100% 0,calc(100% - 18px) 100%,0 100%)}
.f{margin-top:10px;font-size:24px;letter-spacing:.1em;text-transform:uppercase;opacity:.8}
</style>''')

rep('window.ready = (async () => { await nameplate(); composer.render(); composer.render(); return true; })();', r'''
/* ---------- the cinematic ---------- */
const CINE = P.get("cine");
let frameAt = null;
if (CINE) {
  const VAL = CINE === "val";
  const ACC = VAL ? 0xff4655 : 0xf0bd4f, ACC_CSS = VAL ? "#ff4655" : "#f0bd4f", SOFT = VAL ? "#ece8e1" : "#ffe7a8";
  // the crown leaves the throne: keep its place in the world, then move it freely
  scene.updateMatrixWorld(true); scene.attach(crown);
  const c0 = crown.position.clone(), s0 = crown.scale.x, r0 = crown.rotation.clone();
  const target = new THREE.Vector3(0, TOP + 1.42, 1.5);
  const crownSpot = new THREE.PointLight(VAL ? 0xfff2e6 : 0xffe2a0, 0, 4, 2); scene.add(crownSpot);
  const rim = new THREE.PointLight(ACC, 0, 5, 2); scene.add(rim);
  // Valorant: thin angular shards; Mobile Legends: warm sparks. Both burst from behind the crown, then drift.
  const fx = new THREE.Group(); scene.add(fx);
  let fs = 21; const fr = () => ((fs = (fs * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bits = [];
  for (let i = 0; i < (VAL ? 26 : 90); i++) {
    const geo = VAL ? new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.16, 0), new THREE.Vector3(0.035, -0.12, 0), new THREE.Vector3(-0.03, -0.1, 0)]) : new THREE.SphereGeometry(0.012, 8, 6);
    if (VAL) geo.setIndex([0, 1, 2]);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i % 5 === 0 ? 0xece8e1 : ACC, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false }));
    const a = fr() * Math.PI * 2, sp = 0.6 + fr() * 1.6;
    bits.push({ m, dir: new THREE.Vector3(Math.cos(a) * sp, Math.sin(a) * sp * 0.65, -0.2 - fr() * 0.6), spin: (fr() - 0.5) * 1.6, sc: 0.35 + fr() * 0.55 });
    fx.add(m);
  }
  const dimPass = new ShaderPass({ uniforms: { tDiffuse: { value: null }, dim: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float dim; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); float d = length(vUv - vec2(.5,.36)); c.rgb *= mix(1.0, smoothstep(.75,.12,d)*.75 + .25, dim); gl_FragColor = c; }` });
  composer.addPass(dimPass);

  // text, centred under the crown
  const ov = document.createElement("div"); ov.className = "ov"; document.body.append(ov);
  const top = Object.assign(document.createElement("div"), { className: "bar" }), bot = Object.assign(document.createElement("div"), { className: "bar" });
  top.style.top = "0"; bot.style.bottom = "0"; ov.append(top, bot);
  const box = Object.assign(document.createElement("div"), { className: "txt" }); ov.append(box);
  const mk = (cls, txt, css = "") => { const e = Object.assign(document.createElement("div"), { className: cls, textContent: txt }); e.style.cssText = css; box.append(e); return e; };
  const k = mk("k", P.get("head") || (VAL ? "Valorant champions" : "Mobile Legends champions"), `color:${SOFT}`);
  const n = mk("n", TEAM);
  const x = P.get("extra") ? mk("x", P.get("extra"), `background:${ACC_CSS}`) : null;
  const f = P.get("label") ? mk("f", P.get("label"), `color:${SOFT}`) : null;
  requestAnimationFrame(() => { let z = 150; while (n.scrollWidth > 1700 && z > 60) { z -= 4; n.style.fontSize = z + "px"; } });

  const cl = v => Math.max(0, Math.min(1, v)), eo = v => 1 - Math.pow(1 - cl(v), 3), eio = v => { v = cl(v); return v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
  const reveal = (e, at, dy = 30) => { const q = eo((tt - at) / 0.6); e.style.opacity = q; e.style.transform = `translateY(${(1 - q) * dy}px)`; };
  let tt = 0;
  const camFrom = new THREE.Vector3(1.1, 1.05, 9.4), camTo = new THREE.Vector3(0, 1.55, 7.6), look = new THREE.Vector3(0, 1.75, 0);
  frameAt = t => {
    tt = t;
    // camera: a slow push in, then holds
    camera.position.lerpVectors(camFrom, camTo, eio(t / 4)); camera.lookAt(look); camera.fov = 30; camera.updateProjectionMatrix();
    // crown: rests, lifts out (1.4-3.0 s), flies to the centre (3.0-4.6 s), then turns slowly and floats
    const lift = eio((t - 1.4) / 1.6), fly = eio((t - 3.0) / 1.6);
    const up = c0.clone().add(new THREE.Vector3(0, 0.75 * lift, 0.25 * lift));
    crown.position.lerpVectors(up, target, fly);
    crown.position.y += Math.sin(Math.max(0, t - 4.6) * 1.3) * 0.025 * fly;
    crown.scale.setScalar(s0 * (1 + 0.45 * fly));
    crown.rotation.set(r0.x * (1 - fly) + 0.12 * fly, r0.y + lift * 0.6 + Math.max(0, t - 2.2) * 0.62, r0.z * (1 - fly));
    crownSpot.position.copy(crown.position).add(new THREE.Vector3(0.3, 0.6, 0.9)); crownSpot.intensity = 6 * eo((t - 1.2) / 1);
    rim.position.copy(crown.position).add(new THREE.Vector3(0, 0.1, -0.8)); rim.intensity = 10 * eo((t - 3.4) / 1);
    bokeh.uniforms.focus.value = camera.position.distanceTo(crown.position);
    dimPass.uniforms.dim.value = eo((t - 3.6) / 1.2);
    // effects burst when the crown arrives
    const b = Math.max(0, t - 4.2);
    for (const p of bits) {
      p.m.position.copy(target).addScaledVector(p.dir, VAL ? Math.min(b * 0.7, 1.3) + b * 0.05 : b * 0.3).add(new THREE.Vector3(0, VAL ? 0 : b * 0.12, -0.6));
      p.m.rotation.z = p.spin * b; p.m.scale.setScalar(p.sc);
      p.m.material.opacity = b ? cl(b * 3) * (VAL ? 0.9 : 0.8) * (1 - cl((b - 6) / 4) * 0.5) : 0;
    }
    top.style.transform = `translateY(${-(1 - eo(t / 0.8)) * 84}px)`; bot.style.transform = `translateY(${(1 - eo(t / 0.8)) * 84}px)`;
    reveal(k, 4.4); reveal(n, 4.7, 50); if (x) reveal(x, 5.3, 20); if (f) reveal(f, 5.6, 10);
    composer.render();
  };
  window.frameAt = frameAt;
}
window.ready = (async () => { await nameplate(); if (CINE) frameAt(0); else { composer.render(); composer.render(); } return true; })();''')
(HERE / "cinematic.html").write_text(s, encoding="utf-8")
print("wrote cinematic.html")
