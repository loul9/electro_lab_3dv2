
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
'use strict';
const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ---------- puente con el panel de rendimiento ---------- */
const perf = window.__PERF;
const perfLevel = () => (perf ? perf.level() : 'high');
const perfRatio = () => (perf ? perf.ratio() : Math.min(window.devicePixelRatio || 1, 1.5));
const perfFx = () => (perf ? perf.effects() : true);

/* ============================================================
   AUDIO · sonidos sintetizados (sin archivos externos)
   ============================================================ */
let AC = null;
function ensureAudio() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
  } catch (e) { /* sin audio */ }
  return AC;
}
function tone(freq, dur = 0.16, type = 'sine', vol = 0.08, delay = 0) {
  const ac = ensureAudio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.06);
}
function sfxClick() { tone(520, 0.08, 'triangle', 0.05); tone(780, 0.1, 'triangle', 0.04, 0.04); }
function sfxCorrect() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.22, 'triangle', 0.085, i * 0.075)); }
function sfxWrong() { tone(196, 0.24, 'sawtooth', 0.055, 0); tone(146.83, 0.34, 'sawtooth', 0.05, 0.13); }
function sfxBell() {
  const ac = ensureAudio();
  if (!ac) return;
  [0, 0.44].forEach((offset) => {
    [880, 1320, 1760, 2640, 3520].forEach((f, i) => {
      const t0 = ac.currentTime + offset;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * (1 + (i % 2 ? 0.003 : 0)), t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.085 / (i + 1.1), t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.05 + i * 0.08);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 1.4);
    });
  });
}

/* ============================================================
   FONDO · FluxLines (shader WebGL2, optimizado para móvil)
   ============================================================ */
const MAX_COLORS = 6;  // reducido de 8
const FLUX_VERTEX = `#version 300 es
in vec2 aPosition;
void main(){ gl_Position = vec4(aPosition,0.0,1.0); }`;
const FLUX_FIELD = `
float hash(vec3 p3){p3=fract(p3*0.1031);p3+=dot(p3,p3.zyx+33.33);return fract((p3.x+p3.y)*p3.z);}
float smin(float a,float b,float k){float r=exp2(-a/k)+exp2(-b/k);return -k*log2(r);}
float sinlerp(float a,float b,float w){return mix(a,b,(sin(w*3.14159265-3.14159265/2.0)+1.0)/2.0);}
float vn(vec2 p,float s,float seed){
  vec2 cellp=floor(p/s);vec2 relp=mod(p,s);
  float g1=hash(vec3(cellp,seed));float g2=hash(vec3(cellp.x+1.0,cellp.y,seed));
  float g3=hash(vec3(cellp.x+1.0,cellp.y+1.0,seed));float g4=hash(vec3(cellp.x,cellp.y+1.0,seed));
  float bx=sinlerp(g1,g2,relp.x/s);float tx=sinlerp(g4,g3,relp.x/s);return sinlerp(bx,tx,relp.y/s);
}
float dbn(vec2 p,float s,float seed){
  float o=s/2.0;float n0=vn(p,s,seed);float n1=vn(p+vec2(o,o),s,seed+0.1);
  float n2=vn(p+vec2(-o,o),s,seed+0.2);float n3=vn(p+vec2(o,-o),s,seed+0.3);float n4=vn(p+vec2(-o,-o),s,seed+0.4);
  return (2.0*n0+1.5*n1+1.25*n2+1.125*n3+n4)/7.0;
}`;
const FLUX_FRAGMENT = `#version 300 es
precision highp float;precision highp int;
uniform vec2 uResolution;uniform float uTime;uniform vec2 uFlow;uniform float uSpeed;
uniform float uScale;uniform float uTurbulence;uniform float uFluidity;uniform float uRimWidth;
uniform float uSharpness;uniform float uShimmer;uniform float uGlow;uniform float uLine;
uniform float uMaxHalf;uniform vec3 uColors[${MAX_COLORS}];uniform int uColorCount;
uniform vec4 uMagnet;uniform vec4 uSwirl;uniform float uReveal;uniform float uLight;
uniform float uOpaque;uniform vec3 uBackground;uniform float uOpacity;out vec4 outColor;
${FLUX_FIELD}
vec3 palette(float h){
  float x=clamp(h,0.0,1.0)*float(uColorCount-1);int i=int(floor(x));int j=min(i+1,uColorCount-1);
  return mix(uColors[i],uColors[j],smoothstep(0.0,1.0,x-float(i)));
}
void main(){
  float ref=700.0/max(uScale,0.05);vec2 frag=gl_FragCoord.xy;
  vec2 toMagnet=(frag-uMagnet.xy)/uResolution.y;
  float pull=uMagnet.z*exp(-dot(toMagnet,toMagnet)/(uMagnet.w*uMagnet.w));
  if(pull>0.001){float a=pull*0.55;float c=cos(a);float s=sin(a);frag=uMagnet.xy+mat2(c,s,-s,c)*(frag-uMagnet.xy);}
  if(uSwirl.w>0.0){vec2 d=frag-uSwirl.xy;float reach=uSwirl.z;float a=uSwirl.w*exp(-dot(d,d)/(reach*reach));float c=cos(a);float s=sin(a);frag=uSwirl.xy+mat2(c,s,-s,c)*d;}
  vec2 p=frag/uResolution.y*ref;float spd=200.0*uSpeed;float t=uTime;vec2 dir=uFlow;vec2 perp=vec2(-dir.y,dir.x);
  float dist1=vn(p+perp*(t*spd),60.0,10.0)*50.0*uTurbulence;
  float dist2=vn(p-perp*(t*spd),120.0,15.0)*100.0*uTurbulence;
  float peaks=dbn(p+dist1+dir*(t*spd*0.5),40.0,1.0);
  float peaks2=dbn(p+dist2-dir*(t*spd*0.5),40.0,0.0);
  float field=smin(peaks,peaks2,max(uFluidity,0.001));
  float slope=length(vec2(dFdx(field),dFdy(field)));
  float gap=abs(field-0.4);float pixels=gap/max(slope,1e-6);
  float halfBand=max(uRimWidth,0.001)*0.5;
  float across=max(gap/halfBand,pixels/uMaxHalf);
  float band=5.0*uRimWidth*(1.0-across);
  float reveal=smoothstep(0.2,0.85,pull);
  float shimmer=vn(p+dir*(t*spd*0.5),60.0,12.0)*uShimmer*(1.0-reveal*0.75);
  float lit=clamp(band-shimmer,0.0,1.0);
  float glow=pow(lit,uSharpness)*uGlow*(1.0+reveal*0.25);
  float core=uLine>0.0?smoothstep(uLine+0.75,uLine-0.75,pixels)*max(smoothstep(0.08,0.6,glow),reveal):0.0;
  float shine=clamp(glow,0.0,1.0);
  float energy=max(shine*shine,core*0.85)*uReveal;
  float h=clamp(0.5+(peaks-peaks2)*0.8,0.0,1.0);
  vec3 tint=palette(h);
  if(uLight>0.5){float chroma=max(tint.r,max(tint.g,tint.b))-min(tint.r,min(tint.g,tint.b));
    vec3 ink=mix(vec3(0.07),tint*0.55,clamp(chroma*1.6,0.0,1.0));float cover=energy*uOpacity;
    outColor=uOpaque>0.5?vec4(mix(uBackground,ink,cover),1.0):vec4(ink*cover,cover);return;}
  vec3 light=tint*energy*uOpacity;
  outColor=uOpaque>0.5?vec4(uBackground+light,1.0):vec4(light,max(light.r,max(light.g,light.b)));
}`;

function initFlux() {
  const canvas = $('bgFlux');
  if (!canvas) return;
  const isMobile = innerWidth < 768;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) { document.body.classList.add('bg-fallback'); return; }
  // Interruptor del fondo animado según el preset de rendimiento
  let enabled = perf ? perf.background() : true;
  const compile = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source); gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
    gl.deleteShader(sh); return null;
  };
  const vs = compile(gl.VERTEX_SHADER, FLUX_VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FLUX_FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) { document.body.classList.add('bg-fallback'); return; }
  gl.attachShader(program, vs); gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPosition'); gl.linkProgram(program);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { document.body.classList.add('bg-fallback'); return; }
  const u = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) u[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
  }
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Paleta reducida (6 colores) para mejor rendimiento
  const pal = ['#2d00f7', '#6a00f4', '#8900f2', '#b100e8', '#d100d1', '#f20089'];
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const parseColor = (hex) => {
    if (cache.has(hex)) return cache.get(hex);
    let rgb = [1, 1, 1];
    if (probe) {
      probe.fillStyle = '#000'; probe.fillStyle = hex; probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      rgb = [d[0] / 255, d[1] / 255, d[2] / 255];
    }
    cache.set(hex, rgb); return rgb;
  };
  const palette = new Float32Array(MAX_COLORS * 3);
  pal.forEach((hex, i) => palette.set(parseColor(hex), i * 3));

  const pointer = { x: 0, y: 0, inside: false };
  const magnet = { x: 0, y: 0, active: 0 };
  const swirl = { x: 0, y: 0, age: 10 };
  const settings = { speed: 0.28, scale: 1.45, turbulence: 0.8, fluidity: 0.1, rimWidth: 0.2, sharpness: 2.2, shimmer: 1.1, glow: 1.8, lineWidth: 1, opacity: 0.85, mouseStrength: 1, mouseRadius: 0.35, mouseDampening: 0.15 };
  let time = 0, reveal = 0, raf = 0, last = 0, lastPaint = 0;

  function resize() {
    // Resolución del fondo según el preset (baja, media o alta)
    const ratio = perf ? perf.bgRatio() : (isMobile ? 0.5 : 0.75);
    canvas.width = Math.max(1, Math.round(innerWidth * ratio));
    canvas.height = Math.max(1, Math.round(innerHeight * ratio));
    if (!enabled) return;
    render();
    wake();
  }
  function render() {
    const ratio = canvas.width / Math.max(1, innerWidth);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.uResolution, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform2f(u.uFlow, 0, -1);
    gl.uniform1f(u.uSpeed, settings.speed);
    gl.uniform1f(u.uScale, settings.scale);
    gl.uniform1f(u.uTurbulence, settings.turbulence);
    gl.uniform1f(u.uFluidity, settings.fluidity);
    gl.uniform1f(u.uRimWidth, settings.rimWidth);
    gl.uniform1f(u.uSharpness, settings.sharpness);
    gl.uniform1f(u.uShimmer, settings.shimmer);
    gl.uniform1f(u.uGlow, settings.glow);
    gl.uniform1f(u.uLine, settings.lineWidth * ratio * 0.5);
    gl.uniform1f(u.uMaxHalf, 28 * ratio);
    gl.uniform3fv(u.uColors, palette);
    gl.uniform1i(u.uColorCount, pal.length);
    gl.uniform4f(u.uMagnet, magnet.x, magnet.y, magnet.active * settings.mouseStrength, settings.mouseRadius);
    const age = swirl.age;
    const twist = 1.9 * Math.min(1, age / 0.23) * Math.exp(-Math.max(0, age - 0.23) * 1.1);
    gl.uniform4f(u.uSwirl, swirl.x, swirl.y, canvas.height * 0.22 * (1 + age * 0.5), age < 6 ? twist : 0);
    gl.uniform1f(u.uReveal, reveal * reveal * (3 - 2 * reveal));
    gl.uniform1f(u.uLight, 0);
    gl.uniform1f(u.uOpaque, 0);
    gl.uniform3f(u.uBackground, 0.027, 0.012, 0.059);
    gl.uniform1f(u.uOpacity, settings.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    raf = 0;
    if (!enabled || document.hidden) return;
    const cap = perf ? perf.fpsLimit() : 0;
    if (cap && now - lastPaint < 1000 / cap - 1.5) { raf = requestAnimationFrame(frame); return; }
    lastPaint = now;
    const dt = last ? Math.min(0.05, Math.max(0.0005, (now - last) / 1000)) : 1 / 60;
    last = now;
    if (!reduceMotion) time += dt;
    swirl.age += dt;
    if (!reduceMotion && reveal < 1) reveal = Math.min(1, reveal + dt / 1.8);
    else reveal = 1;
    const engaged = pointer.inside && !reduceMotion && !isMobile; // desactivar magnet en móvil
    const follow = 1 - Math.exp(-dt / settings.mouseDampening);
    if (engaged) { magnet.x += (pointer.x - magnet.x) * follow; magnet.y += (pointer.y - magnet.y) * follow; }
    const target = engaged ? 1 : 0;
    magnet.active += (target - magnet.active) * (1 - Math.exp(-dt / 0.3));
    if (Math.abs(target - magnet.active) < 0.001) magnet.active = target;
    render();
    const busy = !reduceMotion || magnet.active !== target || reveal < 1 || swirl.age < 6;
    if (busy) raf = requestAnimationFrame(frame); else last = 0;
  }
  function wake() { if (!enabled) return; if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
  function locate(e) {
    const ratio = canvas.width / Math.max(1, innerWidth);
    pointer.x = e.clientX * ratio;
    pointer.y = (innerHeight - e.clientY) * ratio;
    pointer.inside = e.clientX >= 0 && e.clientY >= 0 && e.clientX <= innerWidth && e.clientY <= innerHeight;
  }
  window.addEventListener('pointermove', (e) => { locate(e); wake(); }, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    locate(e);
    if (!pointer.inside || reduceMotion || isMobile) return; // sin swirl en móvil
    swirl.x = pointer.x; swirl.y = pointer.y; swirl.age = 0; wake();
  }, { passive: true });
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointer.inside = false; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer.inside = false; });
  document.addEventListener('visibilitychange', () => { last = 0; wake(); });
  window.addEventListener('resize', resize);

  // Sincroniza el fondo con el panel de rendimiento
  function syncPerf() {
    const next = perf ? perf.background() : true;
    if (next !== enabled) {
      enabled = next;
      document.body.classList.toggle('bg-off', !enabled);
      canvas.style.display = enabled ? 'block' : 'none';
      if (!enabled) { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
    }
    if (enabled) { last = 0; resize(); }
  }
  window.__bgFlux = { sync: syncPerf, get enabled() { return enabled; } };
  window.addEventListener('perf:change', syncPerf);
  document.body.classList.toggle('bg-off', !enabled);
  if (!enabled) canvas.style.display = 'none';

  resize();
  wake();
}
initFlux();

/* ============================================================
   UTILIDADES DE UI
   ============================================================ */
let statusTimer = 0;
function setStatus(message, ms = 2800) {
  const el = $('status');
  if (!el) return;
  clearTimeout(statusTimer);
  if (!message) { el.classList.remove('show'); return; }
  el.textContent = message;
  el.classList.add('show');
  if (ms > 0) statusTimer = setTimeout(() => el.classList.remove('show'), ms);
}
/* ---------- dial circular (CometDial) ---------- */
function createCometDial({ host, min = 0, max = 100, step = 1, unit = '', label = '', value = 0, size = 100, sweep = 320, thickness = 4, speed = 25, tapBounce = .2, flickBounce = .1, momentum = 1, cometReach = 180, cometWidth = 10, onChange }) {
  const R = 80, DEAD = 44, K = 12, V_FULL = 4, V_FLICK = 2, TAU_FOLLOW = .06, TAU_V = .05, DECEL = .99, DRAG_PX = 10, STALE_MS = 80;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const range = Math.max(1e-9, max - min);
  const gapA = 360 - sweep, start = 90 + gapA / 2, end = start + sweep;
  const stepStr = String(step), dot = stepStr.indexOf('.');
  const decimals = dot === -1 ? 0 : stepStr.length - dot - 1;
  const k = 200 + (clamp(speed, 0, 100) / 100) * 700;
  const crit = 2 * Math.sqrt(k);
  const snap = v => step > 0 ? clamp(Math.round((v - min) / step) * step + min, min, max) : clamp(v, min, max);
  const pointAt = deg => { const a = (deg * Math.PI) / 180; return [100 + Math.cos(a) * R, 100 + Math.sin(a) * R]; };
  const arcPath = (a0, a1) => {
    const [x0, y0] = pointAt(a0), [x1, y1] = pointAt(a1);
    return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
  };
  const velocityOf = hist => {
    if (hist.length < 2) return 0;
    const a = hist[0], b = hist[hist.length - 1];
    return ((b[1] - a[1]) / Math.max(1, b[0] - a[0])) * 1000;
  };
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  host.classList.add('comet-dial');
  host.style.setProperty('--cd-size', size + 'px');
  host.style.setProperty('--cd-figure', Math.round(size * .17) + 'px');
  host.innerHTML =
    `<svg class="comet-dial__ring" viewBox="0 0 200 200" role="slider" tabindex="0" aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}">` +
      `<path class="comet-dial__track" d="${arcPath(start, end)}" stroke-width="${thickness}"/>` +
      `<path class="comet-dial__lit" stroke-width="${thickness}"/>` +
      `<g class="comet-dial__comet">${'<path style="opacity:0"/>'.repeat(K)}</g>` +
      `<circle class="comet-dial__head" r="${(thickness * 1.8).toFixed(1)}"/>` +
    `</svg>` +
    `<div class="comet-dial__readout" aria-hidden="true"><span class="comet-dial__value"><span class="comet-dial__figure"></span>${unit ? `<span class="comet-dial__unit">${unit}</span>` : ''}</span></div>`;
  const svg = host.querySelector('svg');
  const lit = host.querySelector('.comet-dial__lit');
  const head = host.querySelector('.comet-dial__head');
  const figure = host.querySelector('.comet-dial__figure');
  const comet = Array.from(host.querySelectorAll('.comet-dial__comet path'));

  let target = snap(value), reading = target, springV = 0, damp = crit * (1 - tapBounce);
  let raf = 0, prevT = 0, vPrev = null, vSm = 0, lastText = '', lastAria = '';
  let grip = null;

  function paint(now) {
    const dt = prevT ? clamp((now - prevT) / 1000, 0, .05) : 0;
    prevT = now;
    if (grip && grip.at != null) {
      reading = reduce() ? grip.at : reading + (grip.at - reading) * (1 - Math.exp(-dt / TAU_FOLLOW));
    } else {
      springV += (k * (target - reading) - damp * springV) * dt;
      reading += springV * dt;
      if (Math.abs(target - reading) < .002 && Math.abs(springV) < .002) { reading = target; springV = 0; }
    }
    const vRaw = vPrev == null || dt === 0 ? 0 : (reading - vPrev) / dt / range;
    vPrev = reading;
    vSm += (vRaw - vSm) * (1 - Math.exp(-dt / TAU_V));
    const s = clamp(Math.abs(vSm) / V_FULL, 0, 1), dir = Math.sign(vSm) || 1;
    const ang = start + clamp((reading - min) / range, 0, 1) * sweep;
    lit.setAttribute('d', reading > min + .0005 ? arcPath(start, ang) : '');
    const [hx, hy] = pointAt(ang);
    head.setAttribute('cx', hx.toFixed(3));
    head.setAttribute('cy', hy.toFixed(3));
    const seg = (cometReach * s) / K;
    for (let j = 0; j < K; j++) {
      const el = comet[j];
      let a0 = dir > 0 ? ang - (j + 1) * seg : ang + j * seg;
      let a1 = dir > 0 ? ang - j * seg : ang + (j + 1) * seg;
      a0 = clamp(a0, start, end);
      a1 = clamp(a1, start, end);
      if (seg < .01 || a1 - a0 < .01) { if (el.style.opacity !== '0') el.style.opacity = '0'; continue; }
      const w = 1 - j / K;
      el.setAttribute('d', arcPath(a0, a1));
      el.setAttribute('stroke-width', (thickness + cometWidth * w * s).toFixed(2));
      el.style.opacity = (w * s).toFixed(3);
    }
    const shown = clamp(reading, min, max).toFixed(decimals);
    if (shown !== lastText) { lastText = shown; figure.textContent = shown; svg.setAttribute('aria-valuenow', shown); }
    const aria = target.toFixed(decimals) + unit;
    if (aria !== lastAria) { lastAria = aria; svg.setAttribute('aria-valuetext', aria); }
    const moving = !!grip || Math.abs(target - reading) > .001 || Math.abs(springV) > .001 || Math.abs(vSm) > .002;
    raf = moving ? requestAnimationFrame(paint) : 0;
    if (!moving) for (const el of comet) el.style.opacity = '0';
  }

  function wake() {
    if (raf) return;
    prevT = 0; vPrev = null;
    raf = requestAnimationFrame(paint);
  }
  function commit(v) {
    const s = snap(v);
    if (s !== target) { target = s; onChange?.(s); }
  }
  function set(v, instant = true) {
    const s = snap(v);
    if (s === target) return;
    target = s;
    if (instant || reduce()) { reading = s; springV = 0; }
    else { damp = crit * (1 - tapBounce); springV = 0; }
    wake();
  }

  const localPoint = (cx, cy) => {
    const b = svg.getBoundingClientRect();
    return [((cx - b.left) / b.width) * 200 - 100, ((cy - b.top) / b.height) * 200 - 100];
  };
  const angleAt = (cx, cy) => {
    const [x, y] = localPoint(cx, cy);
    let rel = ((Math.atan2(y, x) * 180) / Math.PI - start + 720) % 360;
    if (rel > sweep) rel = grip && grip.side ? (grip.side === 'hi' ? sweep : 0) : rel < sweep + gapA / 2 ? sweep : 0;
    else if (grip) grip.side = rel > sweep / 2 ? 'hi' : 'lo';
    return min + (rel / sweep) * range;
  };

  svg.addEventListener('pointerdown', e => {
    if (grip || e.button > 0) return;
    const [x, y] = localPoint(e.clientX, e.clientY);
    if (Math.hypot(x, y) < DEAD) return;
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch {}
    svg.focus({ preventScroll: true });
    grip = { id: e.pointerId, at: null, hist: [], side: null, moved: false, x0: e.clientX, y0: e.clientY };
    const at = angleAt(e.clientX, e.clientY);
    grip.hist.push([performance.now(), at]);
    host.setAttribute('data-dragging', '');
    commit(at);
    damp = crit * (1 - tapBounce);
    springV = 0;
    wake();

    const move = ev => {
      if (!grip || ev.pointerId !== grip.id) return;
      if (!grip.moved) {
        if (Math.hypot(ev.clientX - grip.x0, ev.clientY - grip.y0) < DRAG_PX) return;
        grip.moved = true;
      }
      grip.at = angleAt(ev.clientX, ev.clientY);
      grip.hist.push([performance.now(), grip.at]);
      if (grip.hist.length > 4) grip.hist.shift();
      commit(grip.at);
      wake();
    };
    const up = ev => {
      if (!grip || ev.pointerId !== grip.id) return;
      const g = grip;
      grip = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      host.removeAttribute('data-dragging');
      try { svg.releasePointerCapture(ev.pointerId); } catch {}
      if (!g.moved) { commit(target); wake(); return; }
      const stale = performance.now() - g.hist[g.hist.length - 1][0] > STALE_MS;
      const v = ev.type === 'pointercancel' || stale ? 0 : velocityOf(g.hist);
      const bounce = tapBounce + (flickBounce - tapBounce) * clamp(Math.abs(v) / range / V_FLICK, 0, 1);
      const to = snap((g.at ?? target) + (v / 1000) * (DECEL / (1 - DECEL)) * momentum);
      commit(to);
      damp = crit * (1 - clamp(bounce, 0, .9));
      springV = v;
      wake();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  svg.addEventListener('keydown', e => {
    const t = target, big = e.shiftKey ? 10 : 1;
    let to;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': to = t + step * big; break;
      case 'ArrowLeft': case 'ArrowDown': to = t - step * big; break;
      case 'PageUp': to = t + step * 10; break;
      case 'PageDown': to = t - step * 10; break;
      case 'Home': to = min; break;
      case 'End': to = max; break;
      default: return;
    }
    e.preventDefault();
    commit(snap(to));
    reading = target; springV = 0;
    wake();
  });

  svg.setAttribute('aria-valuenow', target.toFixed(decimals));
  svg.setAttribute('aria-valuetext', target.toFixed(decimals) + unit);
  paint(performance.now());
  return { set, get: () => target, el: host };
}

/* ============================================================
   PORTADA + NAVEGACIÓN GOOEY
   ============================================================ */
const nav = $('mainNav');
const navPill = $('gooeyPill');
let pillBox = { x: 0, y: 5, w: 78, h: 38 };
let activeNav = document.querySelector('.nav-btn.active');

function moveGoo(btn) {
  if (!btn || !nav || !navPill) return;
  const navRect = nav.getBoundingClientRect();
  const rect = btn.getBoundingClientRect();
  const x = rect.left - navRect.left;
  const y = rect.top - navRect.top;
  const oldX = pillBox.x + pillBox.w / 2;
  const oldY = pillBox.y + pillBox.h / 2;
  const newX = x + rect.width / 2;
  const newY = y + rect.height / 2;
  navPill.style.width = rect.width + 'px';
  navPill.style.height = rect.height + 'px';
  navPill.style.transform = `translate(${x}px, ${y}px)`;
  nav.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
  activeNav = btn;
  if (!reduceMotion && !isMobile && (Math.abs(newX - oldX) > 8 || Math.abs(newY - oldY) > 4)) {
    for (let i = 0; i < 3; i++) {  // reducido de 5 a 3 drops
      const drop = document.createElement('span');
      drop.className = 'gooey-drop';
      const size = 6 + Math.random() * 6;  // tamaños menores
      drop.style.width = drop.style.height = size + 'px';
      drop.style.left = (oldX - size / 2) + 'px';
      drop.style.top = (oldY - size / 2) + 'px';
      nav.appendChild(drop);
      const mx = oldX + (newX - oldX) * (0.35 + Math.random() * 0.3) + (Math.random() - 0.5) * 30;
      const my = oldY + (newY - oldY) * (0.35 + Math.random() * 0.3) + (Math.random() - 0.5) * 20;
      const anim = drop.animate([
        { transform: 'translate(0,0) scale(.6)', opacity: 0.7 },
        { transform: `translate(${mx - oldX}px,${my - oldY}px) scale(1.1)`, opacity: 0.9, offset: 0.55 },
        { transform: `translate(${newX - oldX}px,${newY - oldY}px) scale(.35)`, opacity: 0 }
      ], { duration: 400 + Math.random() * 150, easing: 'cubic-bezier(.3,.9,.3,1)' });
      anim.onfinish = () => drop.remove();
    }
  }
  pillBox = { x, y, w: rect.width, h: rect.height };
}

function placePillNoAnim() {
  if (!activeNav) activeNav = nav?.querySelector('.nav-btn.active');
  if (!activeNav || !nav || !navPill) return;
  const navRect = nav.getBoundingClientRect();
  const rect = activeNav.getBoundingClientRect();
  if (!rect.width) return;
  navPill.style.transition = 'none';
  navPill.style.width = rect.width + 'px';
  navPill.style.height = rect.height + 'px';
  navPill.style.transform = `translate(${rect.left - navRect.left}px, ${rect.top - navRect.top}px)`;
  pillBox = { x: rect.left - navRect.left, y: rect.top - navRect.top, w: rect.width, h: rect.height };
  requestAnimationFrame(() => { if (navPill) navPill.style.transition = ''; });
}

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    moveGoo(btn);
    sfxClick();
    const target = btn.dataset.target;
    if (target === 'ar') {
      $('lab')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      window.dispatchEvent(new CustomEvent('lab:ar'));
    } else if (target === 'vr') {
      window.dispatchEvent(new CustomEvent('lab:vr'));
    } else if (target === 'mp') {
      $('lab')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      window.dispatchEvent(new CustomEvent('lab:mp'));
    } else if (target === 'inicio') {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      $(target)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  });
});

let started = false;
function startExperience() {
  if (started) return;
  started = true;
  ensureAudio();
  sfxClick();
  $('welcome')?.classList.add('gone');
  document.body.classList.add('started');
  $('app')?.setAttribute('aria-hidden', 'false');
  setTimeout(() => { const w = $('welcome'); if (w) w.style.display = 'none'; }, 680);
  window.__labStartRequested = true;
  if (typeof window.__startLab === 'function') window.__startLab();
  setTimeout(() => { placePillNoAnim(); }, 120);
}
$('go')?.addEventListener('click', startExperience);
document.fonts?.ready.then(() => { if (document.body.classList.contains('started')) placePillNoAnim(); });
window.addEventListener('resize', placePillNoAnim);
window.addEventListener('load', placePillNoAnim);
/* ============================================================
   EVALUACIÓN · 20 preguntas de selección múltiple
   ============================================================ */
const QUIZ = [
  { q: 'Un artefacto tecnológico es…', opts: ['Un objeto natural que encontramos en el bosque', 'Un objeto creado por las personas para satisfacer una necesidad', 'Solo un aparato electrónico de última generación', 'Una herramienta que nunca necesita mantenimiento'], a: 1, why: 'Los artefactos son productos de la tecnología: se diseñan y construyen para resolver necesidades humanas.' },
  { q: 'En la linterna, ¿cuál es la fuente de energía que mueve la corriente?', opts: ['El lente', 'El interruptor', 'La pila o batería', 'La carcasa'], a: 2, why: 'La pila transforma energía química en eléctrica; el lente, el interruptor y la carcasa no generan energía.' },
  { q: '¿Cuándo está abierto un circuito eléctrico?', opts: ['Cuando el camino de la corriente está interrumpido', 'Cuando la corriente circula sin interrupciones', 'Cuando la pila está nueva', 'Cuando hay dos bombillos encendidos'], a: 0, why: 'Un circuito abierto tiene una interrupción: la corriente no puede completar el recorrido.' },
  { q: 'La función del interruptor es…', opts: ['Almacenar energía química', 'Transformar la electricidad en luz', 'Aumentar el voltaje de la pila', 'Abrir o cerrar el paso de la corriente'], a: 3, why: 'El interruptor controla el paso de la corriente; al cerrarlo, el circuito queda completo.' },
  { q: 'En una pila, la corriente convencional sale por el polo…', opts: ['Negativo', 'Positivo', 'Metálico de la carcasa', 'De la etiqueta'], a: 1, why: 'Por convención, la corriente sale del polo positivo y regresa al polo negativo.' },
  { q: '¿Qué pieza convierte la energía eléctrica en luz en la linterna?', opts: ['La lente', 'La pila', 'El bombillo o LED', 'El interruptor'], a: 2, why: 'El bombillo o LED es el actuador que convierte la energía eléctrica en luz.' },
  { q: 'El lente de la linterna sirve para…', opts: ['Concentrar y dirigir la luz', 'Guardar energía', 'Cortar el circuito', 'Enfriar el bombillo'], a: 0, why: 'El lente es un componente óptico: concentra y dirige el haz; no forma parte del circuito eléctrico.' },
  { q: '¿Cuál de estos materiales es buen conductor de la electricidad?', opts: ['Madera seca', 'Vidrio', 'Plástico', 'Cobre'], a: 3, why: 'El cobre es un metal y los metales conducen bien. La madera seca, el vidrio y el plástico son aislantes.' },
  { q: 'En el timbre escolar, el sonido se produce cuando…', opts: ['El pulsador se ilumina', 'La campana vibra al ser golpeada', 'La fuente se apaga', 'El cable se calienta'], a: 1, why: 'La campana produce el sonido cuando vibra; el electroimán mueve el badajo que la golpea.' },
  { q: 'El pulsador se diferencia del interruptor porque…', opts: ['Solo cierra el circuito mientras se mantiene presionado', 'Nunca deja pasar la corriente', 'No necesita fuente de energía', 'Solo funciona con corriente alterna'], a: 0, why: 'El pulsador es momentáneo: cierra el circuito solo mientras se presiona. El interruptor puede quedar abierto o cerrado.' },
  { q: 'El motor del ventilador transforma energía eléctrica en…', opts: ['Energía química', 'Energía nuclear', 'Energía sonora únicamente', 'Energía mecánica (movimiento)'], a: 3, why: 'El motor convierte la energía eléctrica en movimiento: energía mecánica.' },
  { q: 'Las aspas del ventilador…', opts: ['Generan electricidad', 'Almacenan carga eléctrica', 'Mueven el aire al girar', 'Filtran el agua'], a: 2, why: 'Las aspas son palas inclinadas que, al girar, desplazan el aire y producen la brisa.' },
  { q: 'Si se desconecta un cable en un circuito simple, el artefacto…', opts: ['Sigue funcionando igual', 'Deja de funcionar porque el circuito se abre', 'Funciona más rápido', 'Carga la pila'], a: 1, why: 'Al desconectar un cable se abre el circuito y la corriente deja de circular.' },
  { q: '¿Cuál elemento protege un circuito de una sobrecarga?', opts: ['El fusible o breaker', 'El lente', 'El aspa', 'La campana'], a: 0, why: 'El fusible o breaker interrumpe la corriente cuando detecta una sobrecarga, protegiendo el circuito.' },
  { q: 'Antes de manipular un circuito eléctrico escolar debes…', opts: ['Mojarte las manos', 'Usar herramientas metálicas sin aislante', 'Trabajar sobre una superficie metálica', 'Desconectar la fuente de energía'], a: 3, why: 'Siempre se desconecta la fuente antes de manipular un circuito; además, se usan herramientas aisladas y superficies secas.' },
  { q: 'Tinkercad Circuits se utiliza para…', opts: ['Editar videos', 'Diseñar portadas', 'Simular y armar circuitos eléctricos', 'Medir la temperatura del aula'], a: 2, why: 'Tinkercad Circuits permite armar y simular circuitos con componentes virtuales.' },
  { q: 'La realidad aumentada (AR)…', opts: ['Reemplaza por completo el mundo real', 'Combina elementos virtuales con el entorno real', 'Solo funciona con gafas costosas', 'Es lo mismo que un video pregrabado'], a: 1, why: 'La AR superpone elementos virtuales al entorno real usando la cámara.' },
  { q: 'La realidad virtual (VR)…', opts: ['Sumerge al usuario en un entorno simulado', 'Mezcla objetos virtuales con el salón', 'Solo reproduce sonidos', 'Muestra planos impresos'], a: 0, why: 'La VR crea un entorno simulado que rodea al usuario; puede usarse con o sin gafas.' },
  { q: 'En MediaPipe, abrir la mano frente a la cámara sirve para…', opts: ['Apagar la cámara', 'Eliminar el modelo 3D', 'Cambiar el idioma', 'Separar las piezas del artefacto'], a: 3, why: 'MediaPipe detecta los puntos de la mano; al abrirla, el visor separa las piezas.' },
  { q: 'Según las orientaciones del MEN (2022), aprender tecnología implica…', opts: ['Memorizar nombres de aparatos', 'Evitar el trabajo en equipo', 'Diseñar, construir y evaluar soluciones tecnológicas', 'Copiar planos sin analizarlos'], a: 2, why: 'El MEN propone una mirada de diseño, construcción y evaluación de soluciones, no la simple memorización.' }
];

const quizQ = $('quizQ'), quizOpts = $('quizOpts'), quizFeedback = $('quizFeedback');
const quizBar = $('quizBar'), quizCounter = $('quizCounter'), quizScore = $('quizScore');
const quizNext = $('quizNext'), quizRestart = $('quizRestart');
let qIndex = 0, qScore = 0, qAnswered = false;

function renderQuiz() {
  const item = QUIZ[qIndex];
  quizCounter.textContent = `Pregunta ${qIndex + 1} de ${QUIZ.length}`;
  quizScore.textContent = `${qScore} / ${QUIZ.length}`;
  quizBar.style.width = ((qIndex + (qAnswered ? 1 : 0)) / QUIZ.length * 100) + '%';
  quizQ.textContent = item.q;
  quizOpts.innerHTML = '';
  item.opts.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quiz-opt';
    const key = document.createElement('span');
    key.className = 'opt-key';
    key.textContent = 'ABCD'[i];
    const label = document.createElement('span');
    label.textContent = text;
    btn.append(key, label);
    btn.addEventListener('click', () => answerQuiz(i));
    quizOpts.appendChild(btn);
  });
  quizFeedback.className = 'feedback';
  quizFeedback.innerHTML = '';
  quizNext.disabled = true;
  quizNext.textContent = qIndex === QUIZ.length - 1 ? 'Ver resultado' : 'Siguiente';
}

function answerQuiz(choice) {
  if (qAnswered) return;
  qAnswered = true;
  ensureAudio();
  const item = QUIZ[qIndex];
  const correct = choice === item.a;
  const buttons = [...quizOpts.children];
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === item.a) btn.classList.add('correct');
    if (i === choice && !correct) btn.classList.add('wrong');
  });
  if (correct) {
    qScore += 1;
    sfxCorrect();
    quizFeedback.className = 'feedback ok';
    quizFeedback.innerHTML = `<b>¡Correcto!</b> ${item.why}`;
  } else {
    sfxWrong();
    quizFeedback.className = 'feedback bad';
    quizFeedback.innerHTML = `<b>Incorrecto.</b> La respuesta correcta es <b>${'ABCD'[item.a]}) ${item.opts[item.a]}</b>. ${item.why}`;
  }
  quizScore.textContent = `${qScore} / ${QUIZ.length}`;
  quizBar.style.width = ((qIndex + 1) / QUIZ.length * 100) + '%';
  quizNext.disabled = false;
}

function finishQuiz() {
  const total = QUIZ.length;
  const pct = Math.round((qScore / total) * 100);
  let title = 'Sigue repasando';
  let message = 'Vuelve al laboratorio, abre y cierra los circuitos y observa qué pasa con cada pieza. Después intenta otra vez.';
  if (pct >= 90) { title = '¡Excelente dominio del circuito!'; message = 'Identificas las piezas, sus funciones y la lógica del circuito. Ahora explica el recorrido de la corriente a un compañero.'; }
  else if (pct >= 70) { title = '¡Muy buen trabajo!'; message = 'Comprendes la mayoría de los conceptos. Revisa las preguntas falladas y prueba de nuevo para consolidar.'; }
  else if (pct >= 50) { title = 'Vas por buen camino'; message = 'Ya reconoces varias piezas y conceptos. Repasa la fuente de energía, el interruptor y la diferencia entre abierto y cerrado.'; }
  quizBar.style.width = '100%';
  quizCounter.textContent = 'Sesión completada';
  quizQ.textContent = 'Resultado de la sesión';
  quizOpts.innerHTML = '';
  const result = document.createElement('div');
  result.className = 'quiz-result';
  result.innerHTML = `<span class="big">${qScore}/${total}</span><div><h3>${title}</h3><p>${message}</p></div>`;
  quizOpts.appendChild(result);
  quizFeedback.className = 'feedback';
  quizFeedback.innerHTML = '';
  quizNext.disabled = true;
  quizNext.textContent = 'Sesión completada';
  if (pct >= 70) sfxCorrect();
}

quizNext?.addEventListener('click', () => {
  if (!qAnswered) return;
  if (qIndex < QUIZ.length - 1) {
    qIndex += 1;
    qAnswered = false;
    renderQuiz();
    quizQ.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  } else {
    finishQuiz();
  }
});
quizRestart?.addEventListener('click', () => {
  qIndex = 0; qScore = 0; qAnswered = false;
  renderQuiz();
  quizQ.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  sfxClick();
});
renderQuiz();

/* ============================================================
   3D · artefactos, escena, GLB embebidos, AR/VR y MediaPipe
   ============================================================ */
const MODELOS = { linterna: "", timbre: "", ventilador: "" };

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .5, metalness: .25, ...o });
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
const cyl = (r, h, s = 32) => new THREE.CylinderGeometry(r, r, h, s);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const G = (x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); return g; };
const PI2 = Math.PI / 2;
const ORIGIN = new THREE.Vector3();
const matsOf = (m) => (Array.isArray(m) ? m : [m]);

const ICONS = {
  linterna: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v2.6l1.4 3.2H7.6L9 5.6z"/><path d="M7.6 9.4h8.8l1.4 10.4H6.2z"/><path d="M7 13.4h10"/><path d="M10 4.2h4"/></svg>',
  timbre: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 16.5h11.6l-1.4-2.4V10a4.4 4.4 0 0 0-8.8 0v4.1z"/><path d="M10 19.2a2.1 2.1 0 0 0 4 0"/><path d="M12 5.2V2.8"/><path d="M4.4 12.6h1.2M18.4 12.6h1.2"/></svg>',
  ventilador: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.1"/><path d="M11.4 10.1c-.4-3.3-2.1-6.1-4.2-5.7-2 .4-2.4 3.7-.4 5.4 1.3 1.1 3 1.4 4.4 1.4z"/><path d="M13.9 12.9c3.1 1.1 6.3 1 6.3-1.1 0-2-3.1-3.2-5.4-1.9-1.5.9-2.2 2.3-2.5 3.6z"/><path d="M10.4 13.7c-1.6 2.9-2.5 5.9-.5 6.4 1.9.5 3.9-2.1 3.2-4.7-.4-1.7-1.6-2.9-2.7-3.6z"/></svg>'
};

/* ---------- artefactos ---------- */
const DEFS = [
  {
    id: 'linterna', title: 'Linterna de mano', short: 'Linterna', icon: ICONS.linterna,
    resumen: 'Circuito: pila (+) → interruptor → bombillo / LED → pila (−)',
    switchPart: 'interruptor',
    wires: [['pila', 'interruptor'], ['interruptor', 'led'], ['led', 'pila']],
    build() {
      const P = {}, R = { glow: 0 };

      const car = G(0, 0, 0);
      const shell = mesh(cyl(.7, 4.4, 40), M(0x39466a, { metalness: .8, roughness: .3 }));
      shell.rotation.z = PI2; car.add(shell);
      [-1.5, -1.05, -.6].forEach((x) => {
        const t = mesh(new THREE.TorusGeometry(.72, .05, 10, 40), M(0x1b2338, { metalness: .85, roughness: .25 }), x);
        t.rotation.y = PI2; car.add(t);
      });
      const head = mesh(new THREE.CylinderGeometry(.95, .7, .8, 40, 1, true), M(0x2b3652, { metalness: .85, roughness: .22, side: THREE.DoubleSide }), 2.35, 0, 0);
      head.rotation.z = -PI2; car.add(head);
      const ring = mesh(new THREE.TorusGeometry(.95, .06, 10, 40), M(0x1b2338, { metalness: .9, roughness: .2 }), 2.74, 0, 0);
      ring.rotation.y = PI2; car.add(ring);
      const tail = mesh(cyl(.72, .12, 40), M(0x1b2338, { metalness: .8 }), -2.2, 0, 0);
      tail.rotation.z = PI2; car.add(tail);
      P.carcasa = {
        obj: car, dir: V(0, 2.6, 0), name: 'Carcasa',
        desc: 'Cubierta de plástico o metal que protege y sostiene todos los componentes. Si es metálica, también puede servir de camino de regreso para la corriente.'
      };

      const pila = G(-.55, 0, 0);
      const b = mesh(cyl(.42, 2.3, 32), M(0x2f9e5a, { roughness: .42, metalness: .3 })); b.rotation.z = PI2; pila.add(b);
      const band = mesh(cyl(.425, .5, 32), M(0xe8c24a, { metalness: .85, roughness: .28 }), .9, 0, 0); band.rotation.z = PI2; pila.add(band);
      const tip = mesh(cyl(.14, .2, 24), M(0xe8c24a, { metalness: .9, roughness: .2 }), 1.25, 0, 0); tip.rotation.z = PI2; pila.add(tip);
      P.pila = {
        obj: pila, dir: V(0, -2.2, 0), name: 'Pila',
        desc: 'Fuente de energía: transforma energía química en eléctrica (una pila AA da 1,5 V). Tiene polo positivo (+) y negativo (−); la corriente sale por el + y regresa por el −.'
      };

      const sw = G(.55, .72, 0);
      sw.add(mesh(box(.9, .16, .5), M(0x2a3550, { metalness: .6, roughness: .4 })));
      R.toggle = mesh(box(.32, .18, .34), M(0xd9354a, { roughness: .35, metalness: .2 }), 0, .16, 0);
      sw.add(R.toggle);
      P.interruptor = {
        obj: sw, dir: V(0, 1.1, 2.6), name: 'Interruptor',
        desc: 'Abre o cierra el circuito. Cerrado: la corriente circula y el bombillo enciende. Abierto: el camino se corta y se apaga. Tócalo para probarlo.'
      };

      const led = G(1.6, 0, 0);
      R.bulbMat = M(0xfff7cf, { emissive: 0xfff2a8, emissiveIntensity: .05, roughness: .25, metalness: .05, transparent: true, opacity: .96 });
      R.bulb = mesh(new THREE.SphereGeometry(.34, 28, 24), R.bulbMat); led.add(R.bulb);
      const refl = mesh(new THREE.ConeGeometry(.72, .9, 32, 1, true), M(0xcfd6e0, { metalness: .95, roughness: .15, side: THREE.DoubleSide }), .4, 0, 0);
      refl.rotation.z = -PI2; led.add(refl);
      R.light = new THREE.PointLight(0xfff2a8, 0, 26); R.light.position.set(.7, 0, 0); led.add(R.light);
      R.spot = new THREE.SpotLight(0xfff3bf, 0, 42, Math.PI / 7, .45, 1.2);
      R.spot.position.set(.9, 0, 0); R.spot.target.position.set(9, 0, 0); led.add(R.spot, R.spot.target);
      P.led = {
        obj: led, dir: V(2.6, 0, 0), name: 'Bombillo / LED',
        desc: 'Convierte la energía eléctrica en luz (y algo de calor). Tiene dos contactos: uno en la punta de la base y otro en la rosca; la corriente entra por uno, atraviesa el filamento o el LED y sale por el otro. Si el circuito está abierto, no se enciende.'
      };

      return { parts: P, refs: R };
    },
    fx(d, dt, on, t) {
      const r = d.refs;
      r.glow += ((on ? 1 : 0) - r.glow) * Math.min(1, dt * 9);
      const g = r.glow;
      r.bulbMat.emissiveIntensity = .05 + g * 3.2;
      r.light.intensity = g * 26;
      r.spot.intensity = g * 46;
      r.toggle.rotation.x = (on ? -.4 : .1) + (on ? Math.sin(t * 2) * .02 : 0);
    }
  },
  {
    id: 'timbre', title: 'Timbre escolar', short: 'Timbre', icon: ICONS.timbre,
    resumen: 'Circuito: fuente → pulsador → campana (electroimán) → fuente',
    switchPart: 'pulsador',
    wires: [['fuente', 'pulsador'], ['pulsador', 'campana'], ['campana', 'fuente']],
    build() {
      const P = {}, R = { ring: 0 };

      const f = G(-2.3, -.45, 0);
      f.add(mesh(box(1.5, .85, .75), M(0x2b3a5c, { metalness: .55, roughness: .4 })));
      f.add(mesh(box(1.28, .08, .58), M(0x1b2438, { metalness: .5, roughness: .45 }), 0, .46, 0));
      f.add(mesh(cyl(.07, .2, 16), M(0xd94a4a, { metalness: .85, roughness: .3 }), -.42, .58, 0));
      f.add(mesh(cyl(.07, .2, 16), M(0x1a1a1a, { metalness: .85, roughness: .3 }), .42, .58, 0));
      const cable = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(.6, .2, 0), V(1.2, .05, .3), V(1.75, -.55, .3), V(1.95, -.95, 0)]), 40, .045, 8, false),
        M(0x10151f, { roughness: .7, metalness: .1 })
      );
      f.add(cable);
      R.cable = cable;
      P.fuente = {
        obj: f, dir: V(-1.7, -1.4, 0), name: 'Fuente de energía',
        desc: 'Pilas o transformador que alimentan el timbre (por ejemplo 6–12 V). Entrega la energía que mueve la corriente por todo el circuito.'
      };

      const pu = G(-.15, -1.15, 0);
      pu.add(mesh(box(.85, .18, .62), M(0x25304a, { metalness: .55, roughness: .4 })));
      pu.add(mesh(cyl(.32, .1, 28), M(0x8b93a7, { metalness: .8, roughness: .3 }), 0, .13, 0));
      R.cap = mesh(cyl(.26, .24, 28), M(0xe4323f, { roughness: .32, metalness: .2 }), 0, .28, 0);
      pu.add(R.cap);
      P.pulsador = {
        obj: pu, dir: V(0, -2.2, 0), name: 'Pulsador',
        desc: 'Interruptor momentáneo: cierra el circuito solo mientras lo presionas y lo abre al soltar. Tócalo para hacer sonar la campana.'
      };

      const bell = G(1.85, .55, 0);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(.86, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2),
        M(0xd8b13a, { metalness: .9, roughness: .22, side: THREE.DoubleSide })
      );
      bell.add(dome);
      const rim = mesh(new THREE.TorusGeometry(.87, .055, 12, 44), M(0xf0cd5a, { metalness: .95, roughness: .18 }), 0, 0, 0);
      rim.rotation.x = PI2; bell.add(rim);
      const knob = mesh(new THREE.SphereGeometry(.12, 20, 16), M(0xf0cd5a, { metalness: .9, roughness: .2 }), 0, .9, 0);
      bell.add(knob);
      R.coil = mesh(cyl(.17, .46, 24), M(0xb87333, { metalness: .8, roughness: .3, emissive: 0xff7a00, emissiveIntensity: 0 }), 0, .5, 0);
      bell.add(R.coil);
      R.striker = new THREE.Group();
      R.striker.position.set(0, .82, 0);
      R.striker.add(mesh(cyl(.045, 1.15, 12), M(0xcfd6e0, { metalness: .9, roughness: .18 }), 0, -.58, 0));
      const clap = mesh(new THREE.SphereGeometry(.15, 20, 16), M(0xe9eefb, { metalness: .85, roughness: .2 }), 0, -1.15, 0);
      R.striker.add(clap);
      bell.add(R.striker);
      R.bell = bell;
      P.campana = {
        obj: bell, dir: V(1.9, 1.5, 0), name: 'Campana',
        desc: 'Campana metálica que produce el sonido al vibrar. El electroimán (bobina de cobre con núcleo) atrae el badajo y lo golpea; al cortar la corriente deja de atraerlo. Por eso el timbre suena solo mientras el pulsador está cerrado.'
      };

      return { parts: P, refs: R };
    },
    fx(d, dt, on, t) {
      const r = d.refs;
      r.ring += ((on ? 1 : 0) - r.ring) * Math.min(1, dt * 12);
      r.bell.rotation.z = Math.sin(t * 46) * .12 * r.ring;
      r.bell.rotation.x = Math.cos(t * 37) * .055 * r.ring;
      const bellPart = d.parts.campana;
      const baseY = bellPart ? bellPart.home.y + bellPart.dir.y * explode : .55;
      r.bell.position.y = baseY + Math.sin(t * 46) * .012 * r.ring;
      r.coil.material.emissiveIntensity = r.ring * 1.5;
      r.cap.position.y = .28 - (on ? .09 : 0) + (on ? Math.sin(t * 46) * .01 : 0);
      r.striker.rotation.z = Math.sin(t * 50) * .05 * r.ring;
    }
  },
  {
    id: 'ventilador', title: 'Ventilador de mesa', short: 'Ventilador', icon: ICONS.ventilador,
    resumen: 'Circuito: fuente (tomacorriente) → interruptor → motor → fuente',
    switchPart: 'interruptor',
    wires: [['fuente', 'interruptor'], ['interruptor', 'motor'], ['motor', 'fuente']],
    build() {
      const P = {}, R = { vel: 0 };

      const base = G(0, -1.85, 0);
      base.add(mesh(cyl(1.42, .24, 48), M(0x2e3550, { metalness: .45, roughness: .5 })));
      base.add(mesh(new THREE.TorusGeometry(1.28, .05, 10, 48), M(0x1b2338, { metalness: .6, roughness: .35 }), 0, .13, 0).rotateX(PI2));
      base.add(mesh(cyl(.17, 2.0, 24), M(0x8a93a8, { metalness: .75, roughness: .3 }), 0, 1.0, 0));
      P.base = {
        obj: base, dir: V(0, -2.4, 0), name: 'Base y soporte',
        desc: 'Sostiene el ventilador y le da estabilidad. No hace parte del circuito eléctrico, pero sostiene el motor y las aspas a la altura adecuada.'
      };

      const mo = G(0, .45, -.05);
      const mb = mesh(cyl(.5, 1.05, 32), M(0x39466a, { metalness: .75, roughness: .3 })); mb.rotation.x = PI2; mb.position.z = -.25; mo.add(mb);
      const cap = mesh(cyl(.52, .18, 32), M(0x1b2338, { metalness: .6, roughness: .4 })); cap.rotation.x = PI2; cap.position.z = -.78; mo.add(cap);
      const guard = mesh(new THREE.TorusGeometry(1.55, .035, 8, 56), M(0x8a93a8, { metalness: .85, roughness: .25 }), 0, 0, .82);
      mo.add(guard);
      const guard2 = mesh(new THREE.TorusGeometry(1.15, .03, 8, 48), M(0x8a93a8, { metalness: .85, roughness: .25 }), 0, 0, .82);
      mo.add(guard2);
      for (let i = 0; i < 4; i++) {
        const sp = mesh(box(.035, 3.05, .025), M(0x8a93a8, { metalness: .8, roughness: .3 }), 0, 0, .82);
        sp.rotation.z = i * Math.PI / 4; mo.add(sp);
      }
      R.motor = mo;
      P.motor = {
        obj: mo, dir: V(0, 1.9, -1.4), name: 'Motor eléctrico',
        desc: 'Motor de corriente continua: la corriente pasa por bobinas que, junto a imanes, crean fuerzas que hacen girar el eje. Convierte energía eléctrica en movimiento.'
      };

      const as = G(0, .45, .58);
      const spin = new THREE.Group(); as.add(spin);
      const hub = mesh(cyl(.2, .38, 24), M(0xd7dcea, { metalness: .85, roughness: .2 })); hub.rotation.x = PI2; spin.add(hub);
      for (let i = 0; i < 3; i++) {
        const arm = new THREE.Group(); arm.rotation.z = i * Math.PI * 2 / 3;
        const bl = mesh(box(.6, 1.25, .07), M(0x63d8ff, { roughness: .35, metalness: .15, transparent: true, opacity: .92 }), 0, .72, 0);
        bl.rotation.y = .38; arm.add(bl); spin.add(arm);
      }
      R.spin = spin;
      P.aspas = {
        obj: as, dir: V(0, 0, 2.8), name: 'Aspas (hélice)',
        desc: 'Palas inclinadas unidas al eje del motor. Al girar empujan el aire y generan la brisa. Su inclinación y tamaño determinan cuánto aire mueven.'
      };

      const sw = G(-1.12, -1.32, .42);
      sw.add(mesh(box(.8, .26, .44), M(0x2a3550, { metalness: .55, roughness: .4 })));
      R.toggle = mesh(box(.3, .22, .26), M(0xd9354a, { roughness: .35 }), 0, .2, 0);
      sw.add(R.toggle);
      P.interruptor = {
        obj: sw, dir: V(-2.0, -.7, 1.6), name: 'Interruptor',
        desc: 'Cierra o abre el circuito entre la fuente y el motor. Es quien decide si el ventilador gira. Tócalo para encenderlo.'
      };

      const fu = G(1.18, -1.5, .04);
      fu.add(mesh(box(1.06, 1.1, .16), M(0xeef1f7, { roughness: .55, metalness: .1 })));
      fu.add(mesh(box(.08, .24, .04), M(0x2a3142, { metalness: .5 }), -.16, .12, .1));
      fu.add(mesh(box(.08, .24, .04), M(0x2a3142, { metalness: .5 }), .16, .12, .1));
      fu.add(mesh(box(.08, .24, .04), M(0x2a3142, { metalness: .5 }), 0, -.34, .1));
      const plug = mesh(box(.46, .38, .26), M(0xd7dcea, { roughness: .45, metalness: .2 }), 0, -.08, .22);
      fu.add(plug);
      const cable2 = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-.15, -.15, .3), V(-.7, -.55, .45), V(-1.3, -1.0, .4), V(-1.85, -1.55, .05)]), 44, .045, 8, false),
        M(0x141a26, { roughness: .7, metalness: .1 })
      );
      fu.add(cable2);
      fu.scale.setScalar(.9);
      P.fuente = {
        obj: fu, dir: V(2.2, -.6, 0), name: 'Fuente de energía',
        desc: 'Tomacorriente con su adaptador y cable: entrega la energía eléctrica al motor. En el aula se analiza en el modelo o en un simulador; nunca se manipula directamente por el riesgo de la red de 120 V.'
      };

      return { parts: P, refs: R };
    },
    fx(d, dt, on, t) {
      const r = d.refs;
      r.vel += ((on ? 16 : 0) - r.vel) * Math.min(1, dt * (on ? 2.4 : 1.5));
      if (r.spin) r.spin.rotation.z += r.vel * dt;
      if (r.toggle) r.toggle.rotation.x = on ? -.4 : .1;
      r.motor.position.x = Math.sin(t * 42) * .012 * (r.vel / 16);
    }
  }
];

/* ---------- escena ---------- */
const viewerEl = $('viewer');
const canvas = $('c');
const labelsEl = $('labels');
const isMobile = innerWidth < 768;
const lowEnd = perfLevel() === 'low';
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isMobile && !lowEnd,
  alpha: true,
  powerPreference: lowEnd ? 'default' : 'high-performance'
});
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
// Pixel ratio según el preset de rendimiento (baja, media o alta)
renderer.setPixelRatio(perfRatio());
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, .1, 200);
camera.position.set(0, 0, 12);

scene.add(new THREE.HemisphereLight(0xdcd2ff, 0x1a0d33, 1.15));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
keyLight.position.set(6, 8, 10); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9f7bff, 1.1);
fillLight.position.set(-8, 2, 6); scene.add(fillLight);
// Luces de rim: se apagan en calidad baja o con los efectos desactivados
const rimPink = new THREE.PointLight(0xf20089, 22, 70, 2);
rimPink.position.set(-7, -4, 6); scene.add(rimPink);
const rimPurple = new THREE.PointLight(0x6a00f4, 18, 70, 2);
rimPurple.position.set(7, 6, -7); scene.add(rimPurple);

function radialTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(169,105,255,.55)');
  g.addColorStop(.45, 'rgba(137,0,242,.22)');
  g.addColorStop(1, 'rgba(137,0,242,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function warmTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,245,1)');
  g.addColorStop(.22, 'rgba(255,244,180,.9)');
  g.addColorStop(.55, 'rgba(255,196,70,.35)');
  g.addColorStop(1, 'rgba(255,170,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const halo = new THREE.Mesh(
  new THREE.CircleGeometry(6.4, 32),  // reducido de 64 a 32 segmentos
  new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false, opacity: .8 })
);
halo.position.set(0, 0, -4.2);
scene.add(halo);

// Polvo: cantidad de partículas según el preset de rendimiento
const dustGeo = new THREE.BufferGeometry();
const dustCount = perf ? perf.dustCount() : (isMobile ? 40 : 60);
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustPos[i * 3] = (Math.random() - .5) * 18;
  dustPos[i * 3 + 1] = (Math.random() - .5) * 12;
  dustPos[i * 3 + 2] = -8 + Math.random() * 5.5;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xc9a6ff, size: .05, transparent: true, opacity: .55, depthWrite: false }));
scene.add(dust);

const highlight = new THREE.BoxHelper(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), 0x5ef2ff);
highlight.visible = false;
scene.add(highlight);

/* ---------- preset de rendimiento aplicado a la escena ---------- */
function applyPerf(detail = {}) {
  const lv = perfLevel();
  const fx = perfFx();
  renderer.setPixelRatio(perfRatio());
  halo.visible = fx;
  dust.visible = fx && lv !== 'low';
  rimPink.visible = fx && lv !== 'low';
  rimPurple.visible = fx && lv !== 'low';
  debouncedResize();
  if (detail.autoDowngrade) {
    setStatus('Ajusté la calidad a ' + (lv === 'low' ? 'baja' : 'media') + ' para mantener la fluidez.', 4200);
  } else if (detail.userChange && detail.level) {
    const name = lv === 'low' ? 'baja' : lv === 'medium' ? 'media' : 'alta';
    setStatus('Calidad ' + name + (fx ? ' · efectos activados' : ' · efectos desactivados'), 2400);
  }
}

/* ---------- dispositivos ---------- */
const devices = DEFS.map((def) => {
  const built = def.build();
  const group = new THREE.Group();
  const dev = {
    def, parts: built.parts, refs: built.refs, group, glb: false,
    zoom: def.id === 'linterna' ? 1.35 : def.id === 'timbre' ? 1.3 : 1.02
  };
  Object.entries(dev.parts).forEach(([id, p]) => {
    p.id = id;
    p.home = p.obj.position.clone();
    p.obj.traverse((o) => { o.userData.partId = id; });
    group.add(p.obj);
    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = p.name;
    l.addEventListener('click', (e) => { e.stopPropagation(); sfxClick(); selectPart(id); });
    labelsEl.appendChild(l);
    p.label = l;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(def.wires.length * 6), 3));
  dev.wires = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8f7bb8, transparent: true, opacity: .55 }));
  dev.wires.frustumCulled = false;
  group.add(dev.wires);
  dev.dots = new THREE.Group();
  dev.dotList = def.wires.map(() => {
    const d = mesh(new THREE.SphereGeometry(.065, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe27a }));
    d.visible = false;
    dev.dots.add(d);
    return d;
  });
  group.add(dev.dots);
  group.visible = false;
  scene.add(group);
  return dev;
});
let cur = devices[0];
cur.group.visible = true;

/* ---------- estado ---------- */
let labStarted = false, on = false, selected = null, explode = 0, explodeTarget = 0;
let vr = false, arOn = false, handOn = false, handActive = false, expHoldUntil = 0;
let rotY = -.42, rotX = .16, tScale = 1, camZ = 12.5;
let bellTimer = 0;
const handPos = new THREE.Vector3();
const gyro = { a: 0, b: Math.PI / 2 };
const _b = new THREE.Box3(), _c = new THREE.Vector3();

const video = $('video'), cursorEl = $('cursor'), cursor2El = $('cursor2'), statusEl = $('status');
const expDial = createCometDial({
  host: $('expDial'), min: 0, max: 100, step: 1, unit: '%', label: 'Separar las piezas del artefacto', value: 0,
  onChange: (v) => { setExplode(v / 100); expHoldUntil = performance.now() + 1300; }
});
const rotDial = createCometDial({
  host: $('rotDial'), min: 0, max: 100, step: 1, unit: '%', label: 'Velocidad de rotación automática', value: 26
});
const autoRotEl = $('autoRot');
const pwrBtn = $('bPower'), pwrLabel = $('powerLabel'), pwrHint = $('powerHint');
const titleEl = $('viewerTitle'), stateEl = $('modelState'), loaderEl = $('viewerLoader');
const partBtnsEl = $('partBtns'), infoEl = $('info'), partCountEl = $('partCount'), devTabsEl = $('devTabs');
const partCardEl = $('partCard'), partCardNameEl = $('partCardName'), partCardDescEl = $('partCardDesc'), partCardTagEl = $('partCardTag');
function showPartCard(name, desc, tag) {
  if (!partCardEl) return;
  partCardNameEl.textContent = name;
  partCardDescEl.textContent = desc;
  partCardTagEl.textContent = tag || '';
  partCardTagEl.hidden = !tag;
  partCardEl.hidden = false;
}
function hidePartCard() {
  if (partCardEl) partCardEl.hidden = true;
}
$('partCardClose')?.addEventListener('click', (e) => { e.stopPropagation(); hidePartCard(); });

/* ---------- interfaz del laboratorio ---------- */
function setInfo(title, desc, tag) {
  infoEl.innerHTML = '';
  const h = document.createElement('h4');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = desc;
  infoEl.append(h, p);
  if (tag) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = tag;
    infoEl.appendChild(t);
  }
}
function deviceSummary(d) {
  hidePartCard();
  setInfo(d.def.title, d.def.resumen + ' · Separa las piezas con el deslizador o con la mano abierta y toca una pieza para ver su función.', '3D · AR · RV');
}
function refreshParts() {
  partBtnsEl.innerHTML = '';
  Object.values(cur.parts).forEach((p) => {
    if (!p.obj) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'part-btn' + (selected === p ? ' active' : '');
    b.dataset.part = p.id;
    const dot = document.createElement('span');
    dot.className = 'part-dot';
    dot.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'part-name';
    name.textContent = p.name;
    const arrow = document.createElement('span');
    arrow.className = 'part-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    b.append(dot, name, arrow);
    b.addEventListener('click', () => {
      ensureAudio();
      sfxClick();
      selectPart(p.id);
    });
    partBtnsEl.appendChild(b);
  });
  partCountEl.textContent = Object.values(cur.parts).filter((p) => p.obj).length;
}
function selectPart(id) {
  const p = cur.parts[id];
  if (!p || !p.obj) return;
  selected = p;
  Object.values(cur.parts).forEach((q) => q.label?.classList.toggle('sel', q === p));
  partBtnsEl.querySelectorAll('.part-btn').forEach((b) => b.classList.toggle('active', b.dataset.part === id));
  const tag = id === cur.def.switchPart
    ? 'Tócalo otra vez para abrir o cerrar el circuito'
    : id === 'fuente' || id === 'pila'
      ? 'Fuente de energía'
      : 'Parte del artefacto';
  setInfo(p.name, p.desc, tag);
  showPartCard(p.name, p.desc, tag);
  if (id === cur.def.switchPart) setPower(!on);
}
function setPower(v, silent = false) {
  const turningOn = v && !on;
  on = v;
  pwrBtn.classList.toggle('on', on);
  pwrBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  pwrLabel.textContent = on ? 'Apagar artefacto' : 'Encender artefacto';
  pwrHint.textContent = on
    ? cur.def.id === 'timbre'
      ? 'Circuito cerrado: la campana vibra y suena.'
      : cur.def.id === 'ventilador'
        ? 'Circuito cerrado: el motor gira y mueve las aspas.'
        : 'Circuito cerrado: la corriente enciende el bombillo.'
    : 'La corriente solo circula cuando el circuito está cerrado.';
  if (on && !silent) {
    ensureAudio();
    if (cur.def.id === 'timbre') {
      sfxBell();
      clearTimeout(bellTimer);
      bellTimer = setTimeout(() => { if (cur.def.id === 'timbre') setPower(false, true); }, 2600);
    } else {
      sfxClick();
    }
  }
}
function switchDevice(i) {
  const next = devices[i];
  if (!next || next === cur) return;
  sfxClick();
  cur.group.visible = false;
  clearTimeout(bellTimer);
  cur = next;
  cur.group.visible = true;
  selected = null;
  highlight.visible = false;
  explode = 0;
  explodeTarget = 0;
  expDial.set(0);
  rotY = -.42; rotX = .16; tScale = 1;
  handPos.set(0, 0, 0);
  setPower(false, true);
  titleEl.textContent = cur.def.title;
  stateEl.textContent = cur.glb ? '· Modelo GLB' : '· Original';
  deviceSummary(cur);
  refreshParts();
  devTabsEl.querySelectorAll('.jelly-radio__chip').forEach((b, j) => {
    b.dataset.on = j === i ? 'true' : 'false';
    b.setAttribute('aria-checked', j === i ? 'true' : 'false');
  });
  applyJelly(i, false);
  if (!cur.glb && PIEZAS[cur.def.id] && GLB_DATA) loadParts(cur).catch(() => {});
  setStatus('Artefacto: ' + cur.def.title, 2200);
}

/* ---------- Selector "jelly" de artefactos ---------- */
const devChips = [];
let devAt = 0;
const JELLY = { swell: .16, barge: 5, shrink: .04, stagger: 22 };

function measureJelly() {
  const widths = devChips.map((c) => c.offsetWidth);
  const chipH = devChips[0] ? devChips[0].offsetHeight : 0;
  const maxW = Math.max(0, ...widths);
  devTabsEl.style.setProperty('--jr-pad-x', (Math.ceil((maxW * JELLY.swell * 1.3) / 2 + JELLY.barge) + 2) + 'px');
  devTabsEl.style.setProperty('--jr-pad-y', (Math.ceil((chipH * JELLY.swell) / 2) + 2) + 'px');
  return widths;
}

function applyJelly(sel, instant) {
  devAt = sel;
  awSync(sel);
  const widths = measureJelly();
  if (instant) {
    devTabsEl.classList.add('is-instant');
    requestAnimationFrame(() => requestAnimationFrame(() => devTabsEl.classList.remove('is-instant')));
  }
  devChips.forEach((chip, i) => {
    const on = i === sel;
    const far = Math.abs(i - sel);
    const push = ((widths[sel] || 0) * JELLY.swell) / 2 + JELLY.barge;
    const x = Math.sign(i - sel) * push;
    const s = on ? 1 + JELLY.swell : 1 - JELLY.shrink;
    chip.style.transitionDelay = instant ? '0ms' : (far * JELLY.stagger) + 'ms';
    chip.style.transform = 'translateX(' + x.toFixed(2) + 'px) scale(' + s + ')';
    chip.dataset.on = on ? 'true' : 'false';
    chip.setAttribute('aria-checked', on ? 'true' : 'false');
    chip.tabIndex = on ? 0 : -1;
  });
}

function onJellyKey(e, i) {
  const n = DEFS.length;
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % n;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + n) % n;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = n - 1;
  else if (e.key === ' ' || e.key === 'Enter') next = i;
  if (next === null) return;
  e.preventDefault();
  if (next !== i) switchDevice(next);
  devChips[next]?.focus();
}

DEFS.forEach((d, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'jelly-radio__chip';
  b.dataset.dev = d.id;
  b.dataset.on = i === 0 ? 'true' : 'false';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', i === 0 ? 'true' : 'false');
  b.tabIndex = i === 0 ? 0 : -1;
  const skin = document.createElement('span');
  skin.className = 'jelly-radio__skin';
  const ic = document.createElement('span');
  ic.className = 'dev-ic';
  ic.setAttribute('aria-hidden', 'true');
  ic.innerHTML = d.icon;
  const label = document.createElement('span');
  label.textContent = d.short;
  skin.append(ic, label);
  b.append(skin);
  b.addEventListener('click', () => switchDevice(i));
  b.addEventListener('keydown', (e) => onJellyKey(e, i));
  devChips.push(b);
  devTabsEl.appendChild(b);
});

requestAnimationFrame(() => applyJelly(0, true));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => applyJelly(devAt, true));
addEventListener('resize', () => applyJelly(devAt, true));
titleEl.textContent = cur.def.title;
deviceSummary(cur);
refreshParts();
const totalPieces = devices.reduce((sum, d) => sum + Object.values(d.parts).filter((p) => p.obj).length, 0);
if ($('statPieces')) $('statPieces').textContent = totalPieces;

/* ---------- GLB embebidos ---------- */
const loader = new GLTFLoader();
let GLB_DATA = null;
const b64buf = (s) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};
const parseGLB = (buf) => new Promise((ok, err) => loader.parse(buf, '', ok, err));
const XAXIS = new THREE.Vector3(1, 0, 0);
let carTransp = false;
const applyTransp = () => devices.forEach((d) => {
  if (!d.carMats) return;
  d.carMats.forEach((m) => { m.opacity = carTransp ? .35 : 1; m.depthWrite = !carTransp; m.transparent = true; });
});

const PIEZAS = {
  linterna: {
    carcasa: {
      glb: 'carcasa', home: [0, 0, 0], dir: [0, 2.6, 0],
      setup(inner, h) {
        inner.position.set(-0.021052791713785695, -0.01411659738712429, -0.009266448895980257);
        h.quaternion.setFromUnitVectors(new THREE.Vector3(0.9274959441651363, 0.03798202930238117, 0.3718986945490604), XAXIS);
        h.scale.setScalar(40);
      }
    },
    pila: {
      glb: 'pila', home: [-1.2, 0, 0], dir: [0, -2.2, 0],
      setup(inner, h) { inner.position.set(0, -0.001, 0); h.rotation.z = -Math.PI / 2; h.scale.setScalar(15.2); }
    },
    interruptor: {
      glb: 'interruptor', home: [.35, .15, 0], dir: [0, 1.2, 2.6],
      setup(inner, h) { inner.position.set(0, 0.001, 0); h.scale.setScalar(24); }
    },
    led: {
      glb: 'bombillo', home: [1.45, 0, 0], dir: [2.6, 0, 0], name: 'Bombillo / LED',
      desc: 'Convierte la energía eléctrica en luz (y algo de calor). Tiene dos contactos: uno en la punta de la base y otro en la rosca; la corriente entra por uno, atraviesa el filamento o el LED y sale por el otro. Si el circuito está abierto, no se enciende.',
      setup(inner, h) { inner.position.set(0, 0.136, 0); h.rotation.z = -Math.PI / 2; h.scale.setScalar(.3); }
    },
    after(dev) {
      dev.zoom = 1.35;
      dev.carMats = [];
      dev.parts.carcasa?.obj?.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const ms = matsOf(o.material).map((m) => m.clone());
        o.material = Array.isArray(o.material) ? ms : ms[0];
        ms.forEach((m) => { m.transparent = true; dev.carMats.push(m); });
      });
      applyTransp();
      let glass = null;
      dev.parts.led?.obj?.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const ms = matsOf(o.material);
        const i = ms.findIndex((m) => m.name === 'bombilla');
        if (i < 0) return;
        const gm = ms[i].clone();
        if (Array.isArray(o.material)) o.material[i] = gm; else o.material = gm;
        glass = gm;
        glass.emissive = new THREE.Color(0xfff2a8);
        glass.emissiveIntensity = 0;
      });
      const light = new THREE.PointLight(0xfff2a8, 0, 30);
      light.position.set(.6, 0, 0);
      dev.parts.led?.obj?.add(light);
      const glowMat = new THREE.SpriteMaterial({
        map: warmTexture(), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(.62, 0, 0);
      glow.scale.setScalar(2.1);
      dev.parts.led?.obj?.add(glow);
      dev.fx = (dt, onNow) => {
        const r = dev.refs;
        r.glow += ((onNow ? 1 : 0) - r.glow) * Math.min(1, dt * 9);
        const g = r.glow;
        if (glass) { glass.emissiveIntensity = g * 3; glass.color.set(g > .35 ? 0xffffff : 0xaab4c0); }
        const fxOn = perfFx();
        light.intensity = g * (fxOn ? 25 : 8);
        glowMat.opacity = fxOn ? g * .82 : 0;
        if (r.toggle) r.toggle.rotation.x = onNow ? -.4 : .1;
      };
    }
  },
  timbre: {
    fuente: {
      glb: 'fuente', home: [-2.3, -.45, 0], dir: [-1.7, -1.4, 0],
      setup(inner) { inner.scale.setScalar(.16); }
    },
    campana: {
      glb: 'campana', home: [1.85, .55, 0], dir: [1.9, 1.5, 0],
      setup(inner) { inner.scale.setScalar(7.5); inner.position.set(0, .38, 0); }
    },
    after(dev) {
      const r = dev.refs;
      // Conserva el cable de la fuente junto a la nueva batería
      if (r.cable && dev.parts.fuente && dev.parts.fuente.obj) {
        dev.parts.fuente.obj.add(r.cable);
        r.cable.traverse((o) => { o.userData.partId = 'fuente'; });
      }
      const p = dev.parts.campana;
      if (!p || !p.obj) return;
      // Conserva el electroimán y el badajo dentro de la nueva campana
      p.obj.add(r.coil, r.striker);
      r.bell = p.obj;
    }
  },
  ventilador: {
    base: {
      glb: 'base', home: [0, -0.6721, -0.0425], dir: [0, -2.4, 0],
      setup(inner) { inner.scale.setScalar(2.8); }
    },
    motor: {
      glb: 'motor', home: [-0.0019, 1.4493, 0.1666], dir: [0, 1.9, -1.4],
      setup(inner) { inner.scale.setScalar(2.8); }
    },
    aspas: {
      glb: 'aspas', home: [-0.004, 1.4459, 0.7542], dir: [0, 0, 2.8],
      setup(inner) { inner.scale.setScalar(2.8); }
    },
    interruptor: {
      glb: 'interruptor', home: [0, 0.1717, -0.0191], dir: [-2.0, -0.7, 1.6],
      setup(inner) { inner.scale.setScalar(2.8); }
    },
    after(dev) {
      const r = dev.refs;
      r.spin = dev.parts.aspas?.obj || null;
      r.motor = dev.parts.motor?.obj || null;
      r.toggle = null;
    }
  }
};

async function loadParts(dev) {
  const spec = PIEZAS[dev.def.id];
  const data = GLB_DATA?.[dev.def.id];
  if (!spec || !data || dev.glb || dev.loading) return;
  dev.loading = true;
  try {
    const built = {};
    await Promise.all(Object.entries(spec)
      .filter(([k]) => k !== 'after')
      .map(async ([id, s]) => {
        if (!data[s.glb]) throw new Error('Falta GLB ' + s.glb);
        const g = await parseGLB(b64buf(data[s.glb]));
        const h = new THREE.Group();
        const w = new THREE.Group();
        h.add(g.scene);
        w.add(h);
        s.setup(g.scene, h, w);
        w.position.set(...s.home);
        built[id] = w;
      }));
    Object.entries(built).forEach(([id, w]) => {
      const p = dev.parts[id];
      if (!p) return;
      const s = spec[id];
      dev.group.remove(p.obj);
      p.obj = w;
      p.home = w.position.clone();
      p.dir = new THREE.Vector3(...s.dir);
      if (s.name) p.name = s.name;
      if (s.desc) p.desc = s.desc;
      w.traverse((o) => { o.userData.partId = id; });
      dev.group.add(w);
    });
    dev.glb = true;
    if (spec.after) spec.after(dev);
    Object.values(dev.parts).forEach((p) => {
      if (!p.label) return;
      p.label.textContent = p.name;
      if (p.obj) p.obj.traverse((o) => { o.userData.partId = p.id; });
    });
    if (dev === cur) {
      stateEl.textContent = '· Modelo GLB';
      refreshParts();
      if (selected && !selected.obj) selected = null;
      if (!selected) deviceSummary(cur);
    }
  } finally {
    dev.loading = false;
  }
}

function applyGLB(dev, gltf) {
  const root = gltf.scene;
  const bbox = new THREE.Box3().setFromObject(root);
  const size = bbox.getSize(new THREE.Vector3());
  const ctr = bbox.getCenter(new THREE.Vector3());
  const s = 5 / Math.max(size.x, size.y, size.z || 1);
  root.scale.multiplyScalar(s);
  root.position.sub(ctr.multiplyScalar(s));
  const names = [];
  root.traverse((o) => { if (o.name) names.push(o.name); });
  const found = [];
  Object.entries(dev.parts).forEach(([id, p]) => {
    let node = null, exact = null;
    root.traverse((o) => {
      if (!o.name) return;
      const n = o.name.toLowerCase();
      if (n === id) exact = o;
      else if (!node && (n.startsWith(id + '_') || n.startsWith(id + '-') || n.startsWith(id + ' ') || n.startsWith(id + '.'))) node = o;
    });
    node = exact || node;
    if (p.obj) dev.group.remove(p.obj);
    if (node) {
      dev.group.attach(node);
      p.obj = node;
      p.home = node.position.clone();
      node.traverse((o) => { o.userData.partId = id; });
      found.push(id);
    } else {
      p.obj = null;
    }
  });
  root.removeFromParent();
  if (!found.length) {
    setStatus('Ninguna pieza coincide. Nombra los nodos como: ' + Object.keys(dev.parts).join(', '), 6000);
    return false;
  }
  dev.glb = true;
  stateEl.textContent = '· GLB propio';
  refreshParts();
  setStatus('Modelo cargado. Piezas encontradas: ' + found.join(', '), 5000);
  return true;
}

function loadGLB(dev, url, onDone) {
  loader.load(url, (g) => {
    const backup = Object.fromEntries(Object.entries(dev.parts).map(([k, p]) => [k, { obj: p.obj, home: p.home.clone() }]));
    if (!applyGLB(dev, g)) {
      Object.entries(backup).forEach(([k, b]) => {
        dev.parts[k].obj = b.obj;
        dev.parts[k].home = b.home;
        if (b.obj) dev.group.add(b.obj);
      });
      refreshParts();
    }
    if (onDone) onDone();
  }, undefined, () => {
    setStatus('No pude cargar el modelo. Verifica que sea un archivo .glb.', 4500);
    if (onDone) onDone();
  });
}

$('glb')?.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f);
  setStatus('Cargando tu modelo…', 0);
  loadGLB(cur, url, () => URL.revokeObjectURL(url));
});
Object.entries(MODELOS).forEach(([id, url]) => { if (url) loadGLB(devices.find((d) => d.def.id === id), url); });

async function bootModels() {
  try {
    const raw = document.getElementById('glb-data')?.textContent || '{}';
    GLB_DATA = JSON.parse(raw);
  } catch (err) {
    GLB_DATA = {};
    console.warn('GLB data', err);
  }
  const pending = devices.filter((d) => PIEZAS[d.def.id] && GLB_DATA[d.def.id]);
  for (const d of pending) {
    try {
      await loadParts(d);
    } catch (err) {
      console.warn('GLB', d.def.id, err);
      setStatus('No pude cargar las piezas 3D; uso la versión básica.', 4200);
    }
  }
  if (GLB_DATA) for (const k in GLB_DATA) delete GLB_DATA[k];
  loaderEl?.classList.add('hide');
  if (cur.glb) stateEl.textContent = '· Modelo GLB';
  setStatus('Modelos 3D listos. Activa la cámara si quieres usar tus manos.', 3800);
}

/* ---------- mapeo del video dentro del visor ---------- */
const vidMap = { dw: 0, dh: 0, dx: 0, dy: 0, vw: 0, vh: 0, w: 0, h: 0 };
function viewerSize() {
  const r = viewerEl.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height), r };
}
function updateVideoMap() {
  const { w: W, h: H } = viewerSize();
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const sc = Math.max(W / vw, H / vh);
  const dw = vw * sc, dh = vh * sc;
  vidMap.vw = vw; vidMap.vh = vh; vidMap.dw = dw; vidMap.dh = dh;
  vidMap.dx = (W - dw) / 2; vidMap.dy = (H - dh) / 2; vidMap.w = W; vidMap.h = H;
}
const toScreen = (x, y) => ({ x: vidMap.dx + (1 - x) * vidMap.dw, y: vidMap.dy + y * vidMap.dh });

let resizeRAF = 0;
function resize() {
  const { w: W, h: H } = viewerSize();
  if (W < 2 || H < 2) return;
  renderer.setPixelRatio(perfRatio());
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  updateVideoMap();
}
function debouncedResize() {
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(resize);
}
const resizeObserver = new ResizeObserver(debouncedResize);
resizeObserver.observe(viewerEl);
window.addEventListener('resize', debouncedResize, { passive: true });
window.addEventListener('orientationchange', () => setTimeout(debouncedResize, 140));

/* ---------- pausa de dibujo cuando el visor no está a la vista ---------- */
let viewerVisible = true;
if ('IntersectionObserver' in window) {
  const visObs = new IntersectionObserver((entries) => {
    entries.forEach((en) => { viewerVisible = en.isIntersecting; });
  }, { rootMargin: '160px' });
  visObs.observe(viewerEl);
}

/* ---------- reacción a los cambios del panel de rendimiento ---------- */
window.addEventListener('perf:change', (e) => {
  updatePerfTimings();
  applyPerf(e.detail || {});
});
applyPerf();

/* ---------- interacción con ratón, lápiz y táctil ---------- */
const ray = new THREE.Raycaster();
let drag = null, pinchD = null;

function pickAt(e) {
  if (!e) return;
  const r = viewerEl.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
  const ny = -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hit = ray.intersectObject(cur.group, true).find((h) => h.object.userData.partId);
  if (hit) {
    ensureAudio();
    selectPart(hit.object.userData.partId);
  }
}
canvas.addEventListener('pointerdown', (e) => {
  if (vr) return;
  drag = { x: e.clientX, y: e.clientY, m: 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || handActive) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.m += Math.abs(dx) + Math.abs(dy);
  rotY += dx * .007;
  rotX = Math.max(-1.15, Math.min(1.15, rotX + dy * .007));
});
canvas.addEventListener('pointerup', (e) => {
  if (drag && drag.m < 7 && !handActive) pickAt(e);
  drag = null;
  canvas.style.cursor = 'grab';
});
canvas.addEventListener('pointercancel', () => { drag = null; canvas.style.cursor = 'grab'; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  tScale = Math.max(.55, Math.min(2.1, tScale * (e.deltaY > 0 ? .92 : 1.08)));
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchD) tScale = Math.max(.55, Math.min(2.1, tScale * d / pinchD));
    pinchD = d;
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { pinchD = null; });

/* ---------- controles ---------- */
function setExplode(v) {
  explodeTarget = Math.max(0, Math.min(1, v));
  expDial.set(Math.round(explodeTarget * 100));
}
autoRotEl.addEventListener('change', () => {
  setStatus(autoRotEl.checked ? 'Rotación automática activa' : 'Rotación automática en pausa', 1800);
});

pwrBtn.addEventListener('click', () => { ensureAudio(); setPower(!on); });
$('bReset')?.addEventListener('click', () => {
  sfxClick();
  setPower(false, true);
  setExplode(0);
  rotY = -.42; rotX = .16; tScale = 1;
  handPos.set(0, 0, 0);
  selected = null;
  highlight.visible = false;
  partBtnsEl.querySelectorAll('.part-btn').forEach((b) => b.classList.remove('active'));
  Object.values(cur.parts).forEach((p) => p.label?.classList.remove('sel'));
  deviceSummary(cur);
  setStatus('Vista original ensamblada', 2000);
});

/* ---------- cambiar artefacto (visor) ---------- */
const awEl = $('artWheel');
const awItems = [];
const AW = { rowH: 30, tilt: 8, curve: 1, fade: .16, blur: .85, min: .3, smooth: .16 };
let awPos = devAt, awTarget = devAt, awSel = devAt, awRaf = null, awLast = 0, awDrag = null, awMoved = false, awTimer = null;

DEFS.forEach((d) => {
  const el = document.createElement('div');
  el.className = 'artifact-wheel__item';
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', 'false');
  el.textContent = d.short;
  el.addEventListener('click', () => {
    if (awMoved) return;
    awSelect(awTarget + (awItems.indexOf(el) - Math.round(awTarget)), true);
  });
  awItems.push(el);
  awEl.appendChild(el);
});

function awFrame(now) {
  const dt = Math.min((now - awLast) / 1000, .05);
  awLast = now;
  const k = 1 - Math.exp(-dt / AW.smooth);
  let next = awPos + (awTarget - awPos) * k;
  const done = Math.abs(awTarget - next) < .001;
  if (done) next = awTarget;
  awPos = next;
  const rad = AW.tilt * Math.PI / 180;
  const R = rad > .0005 ? AW.rowH / rad : 0;
  awItems.forEach((el, i) => {
    const d = i - next, dist = Math.abs(d);
    const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * rad));
    const x = -R * (1 - Math.cos(ang)) * AW.curve;
    const y = R * Math.sin(ang);
    el.style.transform = 'translate(' + x.toFixed(2) + 'px, calc(' + y.toFixed(2) + 'px - 50%)) rotate(' + (ang * 180 / Math.PI).toFixed(2) + 'deg)';
    el.style.opacity = String(Math.max(AW.min, 1 - dist * AW.fade));
    el.style.filter = 'blur(' + (dist * AW.blur).toFixed(2) + 'px)';
    el.style.setProperty('--aw-p', Math.max(0, 1 - Math.min(dist, 1)).toFixed(4));
  });
  awRaf = done ? null : requestAnimationFrame(awFrame);
}

function awStart() {
  if (awRaf != null) cancelAnimationFrame(awRaf);
  awLast = performance.now();
  awRaf = requestAnimationFrame(awFrame);
}

function awPaintSel() {
  awItems.forEach((el, i) => el.setAttribute('aria-selected', i === awSel ? 'true' : 'false'));
}

function awSelect(v, snap) {
  const n = DEFS.length;
  let value = Math.max(0, Math.min(n - 1, v));
  if (snap) value = Math.round(value);
  awTarget = value;
  const idx = Math.round(value);
  if (idx !== awSel) {
    awSel = idx;
    awPaintSel();
    switchDevice(idx);
  }
  awStart();
}

function awSync(i) {
  if (i === awSel) return;
  awSel = i;
  awTarget = i;
  awPaintSel();
  awStart();
}

function awOpen(open) {
  awEl.dataset.open = open ? 'true' : 'false';
  awEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    awTarget = awPos = awSel = devAt;
    awPaintSel();
    awStart();
    awEl.focus({ preventScroll: true });
  }
}

$('bCycle')?.addEventListener('click', () => {
  awOpen(awEl.dataset.open !== 'true');
});

awEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const step = Math.max(-1, Math.min(1, e.deltaY / AW.rowH));
  awSelect(awTarget + step, false);
  clearTimeout(awTimer);
  awTimer = setTimeout(() => awSelect(awTarget, true), 140);
}, { passive: false });

awEl.addEventListener('pointerdown', (e) => {
  awDrag = { y: e.clientY, start: awTarget, id: e.pointerId };
  awMoved = false;
  awEl.setAttribute('data-drag', '');
});

awEl.addEventListener('pointermove', (e) => {
  if (!awDrag) return;
  const dy = e.clientY - awDrag.y;
  if (!awMoved && Math.abs(dy) > 4) {
    awMoved = true;
    awEl.setPointerCapture(awDrag.id);
  }
  if (awMoved) awSelect(awDrag.start - dy / AW.rowH, false);
});

function awEnd() {
  if (!awDrag) return;
  awDrag = null;
  awEl.removeAttribute('data-drag');
  if (awMoved) awSelect(awTarget, true);
  setTimeout(() => { awMoved = false; }, 0);
}
awEl.addEventListener('pointerup', awEnd);
awEl.addEventListener('pointercancel', awEnd);

awEl.addEventListener('keydown', (e) => {
  let step = 0;
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') step = -1;
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') step = 1;
  else if (e.key === 'Escape') { awOpen(false); $('bCycle')?.focus(); return; }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); awSelect(awTarget, true); return; }
  else return;
  e.preventDefault();
  awSelect(Math.round(awTarget) + step, true);
});

document.addEventListener('pointerdown', (e) => {
  if (awEl.dataset.open !== 'true') return;
  if (awEl.contains(e.target) || $('bCycle')?.contains(e.target)) return;
  awOpen(false);
});

awStart();

/* ---------- luz especular del botón "Cambiar artefacto" ---------- */
(() => {
  const btn = $('bCycle');
  const canvas = btn?.querySelector('.viewer-cycle__light');
  const gl = canvas?.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!btn || !canvas || !gl) return;

  const PAD = 14;
  const TAU = Math.PI * 2;
  const VERT = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;
  const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uPx;
uniform float uSpot;
uniform vec2 uEntry;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform vec2 uWindow;
uniform float uThickness;
uniform float uGlow;
out vec4 outColor;
float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float loopPosition(vec2 p, vec2 b, float r) {
  vec2 inner = b - r;
  float arc = 1.5707963 * r;
  float quarter = inner.x + inner.y + arc;
  vec2 a = abs(p);
  vec2 q = a - inner;
  float s = q.x > 0.0 && q.y > 0.0
    ? inner.y + atan(q.y, q.x) * r
    : (q.x > q.y ? min(a.y, inner.y) : inner.y + arc + inner.x - min(a.x, inner.x));
  if (p.x < 0.0) s = p.y >= 0.0 ? 2.0 * quarter - s : 2.0 * quarter + s;
  else if (p.y < 0.0) s = 4.0 * quarter - s;
  return s / max(4.0 * quarter, 0.0001);
}
float lobe(float position, float center) {
  float gap = abs(fract(position - center + 0.5) - 0.5);
  return 1.0 - smoothstep(uWindow.x, uWindow.x + uWindow.y, gap);
}
void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = roundedBox(p, uHalf, uRadius);
  float position = loopPosition(p, uHalf, uRadius);
  float key = lobe(position, uSpot);
  float back = lobe(position, uSpot + 0.5);
  float streak = key + back * 0.45;
  float width = max(uThickness * uPx * mix(1.0, max(key, back), 0.6), 0.35);
  float band = smoothstep(-width - 0.6, -width + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float hair = smoothstep(-uPx - 0.6, -uPx + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  vec2 pool = (p - uEntry) / (uHalf.y * vec2(1.6, 1.1));
  float glow = streak * 0.2 * exp(-abs(d + width * 0.5) / (5.0 * uPx)) + inside * 0.08 * exp(-dot(pool, pool));
  float light = clamp((band * streak + glow * uGlow) * uIntensity, 0.0, 1.0);
  vec4 base = vec4(uBaseColor, 1.0) * hair * 0.6;
  outColor = vec4(uLineColor, 1.0) * light + base * (1.0 - light);
}`;
  const UNIFORMS = ['uCenter','uHalf','uRadius','uPx','uSpot','uEntry','uLineColor','uBaseColor','uIntensity','uWindow','uThickness','uGlow'];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const wrap = (v) => v - Math.floor(v);

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
    gl.deleteShader(sh);
    return null;
  };
  const v = compile(gl.VERTEX_SHADER, VERT);
  const f = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!v || !f || !program) return;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

  const uniforms = {};
  for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const S = {
    lineColor: '#ffffff', baseColor: '#9a8ab4', intensity: 1, idleIntensity: 0.45,
    shineSize: 10, shineFade: 34, thickness: 1.2, glow: 1, proximity: 250
  };
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const colors = new Map();
  const view = { width: 1, height: 1, ratio: 1, radius: 999 };
  const pointer = { x: 0, y: 0, known: false };
  const state = { spot: 0, level: 0, press: 0, ready: false };
  let raf = 0;
  let last = 0;
  let visible = true;

  const toRgb = (value) => {
    if (colors.has(value)) return colors.get(value);
    let rgb = [1, 1, 1];
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000000';
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
      rgb = [r / 255, g / 255, b / 255];
    }
    colors.set(value, rgb);
    return rgb;
  };

  const loopPosition = (x, y, halfX, halfY, r) => {
    const innerX = halfX - r;
    const innerY = halfY - r;
    const arc = (Math.PI / 2) * r;
    const quarter = innerX + innerY + arc;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const qx = ax - innerX;
    const qy = ay - innerY;
    let s;
    if (qx > 0 && qy > 0) s = innerY + Math.atan2(qy, qx) * r;
    else if (qx > qy) s = Math.min(ay, innerY);
    else s = innerY + arc + innerX - Math.min(ax, innerX);
    if (x < 0) s = y >= 0 ? 2 * quarter - s : 2 * quarter + s;
    else if (y < 0) s = 4 * quarter - s;
    return wrap(s / Math.max(4 * quarter, 0.0001));
  };

  const rimPoint = (position, halfX, halfY, r) => {
    const innerX = halfX - r;
    const innerY = halfY - r;
    const arc = (Math.PI / 2) * r;
    const quarter = innerX + innerY + arc;
    let s = wrap(position) * 4 * quarter;
    let signX = 1;
    let signY = 1;
    if (s > 3 * quarter) { s = 4 * quarter - s; signY = -1; }
    else if (s > 2 * quarter) { s -= 2 * quarter; signX = -1; signY = -1; }
    else if (s > quarter) { s = 2 * quarter - s; signX = -1; }
    let x = innerX - (s - innerY - arc);
    let y = halfY;
    if (s <= innerY) { x = halfX; y = s; }
    else if (s <= innerY + arc) {
      const angle = (s - innerY) / Math.max(r, 0.0001);
      x = innerX + Math.cos(angle) * r;
      y = innerY + Math.sin(angle) * r;
    }
    return [x * signX, y * signY];
  };

  const restSpot = () => {
    const r = view.radius;
    const inset = r * (1 - Math.SQRT1_2);
    return loopPosition(inset - view.width / 2, view.height / 2 - inset, view.width / 2, view.height / 2, r);
  };

  const aim = () => {
    if (!pointer.known) return null;
    const rect = btn.getBoundingClientRect();
    const scale = rect.width / view.width || 1;
    const halfX = view.width / 2;
    const halfY = view.height / 2;
    const x = (pointer.x - rect.left - rect.width / 2) / scale;
    const y = (rect.top + rect.height / 2 - pointer.y) / scale;
    const distance = Math.hypot(Math.max(Math.abs(x) - halfX, 0), Math.max(Math.abs(y) - halfY, 0));
    const t = clamp(1 - distance / S.proximity, 0, 1);
    const near = t * t * (3 - 2 * t);
    const nearest = loopPosition(x, y, halfX, halfY, view.radius);
    return { spot: nearest, near };
  };

  const draw = () => {
    const { width, height } = view;
    const scaleX = canvas.width / (width + PAD * 2);
    const scaleY = canvas.height / (height + PAD * 2);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uCenter, (PAD + width / 2) * scaleX, (PAD + height / 2) * scaleY);
    gl.uniform2f(uniforms.uHalf, (width / 2) * scaleX, (height / 2) * scaleY);
    gl.uniform1f(uniforms.uRadius, Math.min(view.radius, width / 2, height / 2) * scaleX);
    gl.uniform1f(uniforms.uPx, view.ratio);
    const [rimX, rimY] = rimPoint(state.spot, width / 2, height / 2, Math.min(view.radius, width / 2, height / 2));
    const len = Math.max(Math.hypot(rimX, rimY), 0.0001);
    const pull = 1 - Math.min(0.35 * (height / 2), len) / len;
    gl.uniform1f(uniforms.uSpot, state.spot);
    gl.uniform2f(uniforms.uEntry, rimX * pull * scaleX, rimY * pull * scaleY);
    gl.uniform3fv(uniforms.uLineColor, toRgb(S.lineColor));
    gl.uniform3fv(uniforms.uBaseColor, toRgb(S.baseColor));
    gl.uniform1f(uniforms.uIntensity, S.intensity * (state.level + state.press * 0.8));
    gl.uniform2f(uniforms.uWindow, S.shineSize / 360 + state.press * 0.06, S.shineFade / 360 + 0.0001);
    gl.uniform1f(uniforms.uThickness, S.thickness);
    gl.uniform1f(uniforms.uGlow, S.glow);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  const frame = (now) => {
    raf = 0;
    if (!visible) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (!state.ready) {
      state.spot = restSpot();
      state.level = S.idleIntensity;
      state.ready = true;
    }
    const target = aim();
    let diff = 0;
    if (target) {
      diff = (target.near > 0 ? target.spot : restSpot()) - state.spot;
      diff -= Math.round(diff);
      state.spot = wrap(state.spot + diff * (1 - Math.exp(-dt * 8)));
    }
    const level = S.idleIntensity + (1 - S.idleIntensity) * (target ? target.near : 0);
    state.level += (level - state.level) * (1 - Math.exp(-dt * 7));
    state.press *= Math.exp(-dt * 5);
    draw();
    if (Math.abs(diff) > 0.0002 || Math.abs(level - state.level) > 0.001 || state.press > 0.002) {
      raf = requestAnimationFrame(frame);
    } else {
      last = 0;
    }
  };

  const wake = () => {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  };

  const measure = () => {
    view.width = Math.max(1, btn.offsetWidth);
    view.height = Math.max(1, btn.offsetHeight);
    view.ratio = Math.min(window.devicePixelRatio || 1, 3);
    view.radius = parseFloat(getComputedStyle(btn).getPropertyValue('--sb-radius')) || 18;
    canvas.width = Math.max(1, Math.round((view.width + PAD * 2) * view.ratio));
    canvas.height = Math.max(1, Math.round((view.height + PAD * 2) * view.ratio));
    if (state.ready) draw();
    wake();
  };

  window.addEventListener('pointermove', (event) => {
    const rect = btn.getBoundingClientRect();
    if (event.clientX < rect.left - 300 || event.clientX > rect.right + 300 ||
        event.clientY < rect.top - 300 || event.clientY > rect.bottom + 300) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.known = true;
    wake();
  }, { passive: true });

  const end = (event) => {
    if (event.pointerType === 'mouse') return;
    pointer.known = false;
    wake();
  };
  window.addEventListener('pointerup', end, { passive: true });
  window.addEventListener('pointercancel', end, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer.known = false; wake(); });
  btn.addEventListener('pointerdown', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.known = true;
    state.press = 1;
    wake();
  });

  new ResizeObserver(measure).observe(btn);
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) { last = 0; wake(); }
  }).observe(btn);
  measure();
})();

/* ---------- pantalla completa ---------- */
async function toggleFull() {
  const el = viewerEl;
  if (el.classList.contains('pseudo-full')) {
    el.classList.remove('pseudo-full');
    $('bFull')?.classList.remove('on');
    setTimeout(resize, 90);
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (el.requestFullscreen) await el.requestFullscreen();
    else { el.classList.add('pseudo-full'); $('bFull')?.classList.add('on'); }
  } catch (err) {
    el.classList.add('pseudo-full');
    $('bFull')?.classList.add('on');
  }
  setTimeout(resize, 90);
}
$('bFull')?.addEventListener('click', () => { sfxClick(); toggleFull(); });
document.addEventListener('fullscreenchange', () => {
  const fs = document.fullscreenElement === viewerEl;
  $('bFull')?.classList.toggle('on', fs);
  if (!fs && vr) exitVR(true);
  setTimeout(resize, 70);
});

/* ---------- realidad virtual ---------- */
const onOrient = (e) => {
  gyro.a = (e.alpha || 0) * Math.PI / 180;
  gyro.b = (e.beta || 0) * Math.PI / 180;
};
async function enterVR() {
  if (vr) return;
  ensureAudio();
  sfxClick();
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch (err) {}
  window.addEventListener('deviceorientation', onOrient);
  vr = true;
  document.body.classList.add('vr');
  viewerEl.classList.add('vr-mode');
  video.style.display = 'none';
  cursorEl.style.display = 'none';
  cursor2El.style.display = 'none';
  handActive = false;
  tScale = .9;
  setExplode(.65);
  try { if (viewerEl.requestFullscreen) await viewerEl.requestFullscreen(); } catch (err) {}
  setStatus('RV: mueve el dispositivo para mirar alrededor', 3600);
  setTimeout(resize, 130);
}
function exitVR(fromFullscreen = false) {
  if (!vr) return;
  vr = false;
  document.body.classList.remove('vr');
  viewerEl.classList.remove('vr-mode');
  window.removeEventListener('deviceorientation', onOrient);
  if (!fromFullscreen && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (arOn && video.srcObject) video.style.display = 'block';
  tScale = 1;
  setStatus('Saliste de RV', 1800);
  setTimeout(resize, 110);
}
$('bVR')?.addEventListener('click', enterVR);
$('exitvr')?.addEventListener('click', () => exitVR());

/* ---------- realidad aumentada + MediaPipe ---------- */
let hands = null, mpLoading = false, lastDetect = 0;

async function initHands() {
  if (hands || mpLoading) return hands;
  mpLoading = true;
  setStatus('Cargando MediaPipe Tasks…', 0);
  try {
    const MP = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/+esm');
    const fileset = await MP.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm');
    const opts = (delegate) => ({
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate
      },
      runningMode: 'VIDEO',
      numHands: 2
    });
    try { hands = await MP.HandLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (err) { hands = await MP.HandLandmarker.createFromOptions(fileset, opts('CPU')); }
    setStatus('Manos listas: izquierda pellizca para elegir, derecha abre o cierra para separar', 4600);
    return hands;
  } catch (err) {
    console.warn('MediaPipe', err);
    setStatus('No se pudo cargar MediaPipe. Usa ratón, lápiz y el deslizador.', 4800);
  } finally {
    mpLoading = false;
  }
}

async function initCamera() {
  if (video.srcObject) return true;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin cámara');
  const lowCam = perfLevel() === 'low';
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: lowCam ? 640 : 1280 }, height: { ideal: lowCam ? 480 : 720 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  video.style.display = (arOn && !vr) ? 'block' : 'none';
  updateVideoMap();
  window.addEventListener('pagehide', () => {
    try { stream.getTracks().forEach((t) => t.stop()); } catch (err) {}
  });
  return true;
}

function syncAR() {
  const b1 = $('bAR'), b2 = $('bAR2');
  b1?.classList.toggle('on', arOn);
  b1?.setAttribute('aria-pressed', arOn ? 'true' : 'false');
  if (b1) b1.title = arOn ? 'Desactivar realidad aumentada' : 'Activar realidad aumentada';
  b2?.classList.toggle('on', arOn);
  b2?.setAttribute('aria-pressed', arOn ? 'true' : 'false');
  if (b2) b2.textContent = arOn ? 'Desactivar AR' : 'Activar AR';
}

function syncMP() {
  const b1 = $('bMP'), b2 = $('bMP2');
  b1?.classList.toggle('on', handOn);
  b1?.setAttribute('aria-pressed', handOn ? 'true' : 'false');
  if (b1) b1.title = handOn ? 'Desactivar MediaPipe (manos)' : 'Activar MediaPipe (manos)';
  b2?.classList.toggle('on', handOn);
  b2?.setAttribute('aria-pressed', handOn ? 'true' : 'false');
  if (b2) b2.textContent = handOn ? 'Desactivar MediaPipe' : 'Activar MediaPipe';
}

function stopCamera() {
  try {
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  } catch (err) { /* sin cámara */ }
}

async function toggleAR(force) {
  const target = typeof force === 'boolean' ? force : !arOn;
  if (target === arOn) return;
  if (target) {
    setStatus('Solicitando permiso de cámara…', 0);
    try {
      await initCamera();
    } catch (err) {
      arOn = false;
      syncAR();
      setStatus('Sin cámara: usa ratón, lápiz y el deslizador. La página funciona igual.', 4800);
      return;
    }
    arOn = true;
    if (!vr) video.style.display = 'block';
    updateVideoMap();
    syncAR();
    setStatus('AR activa: el entorno real con el modelo 3D encima', 3600);
  } else {
    arOn = false;
    video.style.display = 'none';
    if (!handOn) stopCamera();
    syncAR();
    setStatus('AR desactivada', 1800);
  }
}

async function toggleMP(force) {
  const target = typeof force === 'boolean' ? force : !handOn;
  if (target === handOn) return;
  if (target) {
    setStatus('Solicitando permiso de cámara…', 0);
    try {
      await initCamera();
    } catch (err) {
      handOn = false;
      syncMP();
      setStatus('Sin cámara: usa ratón, lápiz y el deslizador. La página funciona igual.', 4800);
      return;
    }
    handOn = true;
    syncMP();
    video.style.display = (arOn && !vr) ? 'block' : 'none';
    const loaded = await initHands();
    if (!loaded) {
      handOn = false;
      syncMP();
      if (!arOn) stopCamera();
    }
  } else {
    handOn = false;
    handActive = false;
    hideHandCursors();
    pinchState.clear();
    handPos.set(0, 0, 0);
    if (!arOn) stopCamera();
    syncMP();
    setStatus('MediaPipe desactivado', 1800);
  }
}

$('bAR')?.addEventListener('click', () => { ensureAudio(); sfxClick(); toggleAR(); });
$('bAR2')?.addEventListener('click', () => { ensureAudio(); sfxClick(); toggleAR(); });
$('bMP')?.addEventListener('click', () => { ensureAudio(); sfxClick(); toggleMP(); });
$('bMP2')?.addEventListener('click', () => { ensureAudio(); sfxClick(); toggleMP(); });
window.addEventListener('lab:ar', () => toggleAR(true));
window.addEventListener('lab:vr', () => enterVR());
window.addEventListener('lab:mp', () => toggleMP(true));

/* ---------- WebXR (dispositivos avanzados) ---------- */
const xrBtn = $('perfXR');
const xrLbl = $('perfXRLbl');
const xrHint = $('perfXRHint');
const XR_POS = new THREE.Vector3(0, 0, -5);
let xrSession = null;
let xrMode = null;

function syncXR(active, message) {
  xrBtn?.classList.toggle('on', !!active);
  xrBtn?.setAttribute('aria-pressed', active ? 'true' : 'false');
  if (xrLbl) xrLbl.textContent = active ? 'Salir de WebXR' : 'Activar WebXR';
  if (xrHint && message) xrHint.textContent = message;
}

async function xrSupported(mode) {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported(mode)); }
  catch (err) { return false; }
}

async function toggleWebXR() {
  if (xrSession) {
    try { await xrSession.end(); } catch (err) {}
    return;
  }
  if (!navigator.xr) {
    syncXR(false, 'WebXR no está disponible en este navegador.');
    setStatus('WebXR no disponible: usa Chrome o Edge actualizado y una conexión segura.', 4600);
    return;
  }
  const mode = (await xrSupported('immersive-ar')) ? 'immersive-ar'
    : (await xrSupported('immersive-vr')) ? 'immersive-vr' : null;
  if (!mode) {
    syncXR(false, 'Este dispositivo no admite sesiones inmersivas WebXR.');
    setStatus('WebXR no compatible con este dispositivo.', 4600);
    return;
  }
  try {
    ensureAudio();
    sfxClick();
    const session = await navigator.xr.requestSession(mode, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hit-test']
    });
    xrSession = session;
    xrMode = mode;
    renderer.xr.setReferenceSpaceType(mode === 'immersive-ar' ? 'local' : 'local-floor');
    await renderer.xr.setSession(session);
    $('perfClose')?.click();
    syncXR(true, mode === 'immersive-ar'
      ? 'Sesión de realidad aumentada activa.'
      : 'Sesión de realidad virtual activa.');
    setStatus('WebXR activo · ' + (mode === 'immersive-ar' ? 'realidad aumentada' : 'realidad virtual'), 4200);
    clock.getDelta();
    renderer.setAnimationLoop(frame);
    session.addEventListener('end', () => {
      xrSession = null;
      xrMode = null;
      renderer.setAnimationLoop(null);
      syncXR(false, 'Sesión finalizada. Puedes iniciarla otra vez cuando quieras.');
      setStatus('Saliste de WebXR', 2200);
      requestAnimationFrame(frame);
      setTimeout(resize, 140);
    });
  } catch (err) {
    console.warn('WebXR', err);
    xrSession = null;
    xrMode = null;
    syncXR(false, 'No se pudo iniciar WebXR. Revisa permisos y compatibilidad.');
    setStatus('No se pudo iniciar WebXR en este dispositivo.', 4600);
  }
}
xrBtn?.addEventListener('click', toggleWebXR);

(async () => {
  if (!xrBtn) return;
  if (!navigator.xr) {
    xrBtn.disabled = true;
    syncXR(false, 'WebXR no está disponible en este navegador. Prueba Chrome o Edge actualizado.');
    return;
  }
  const ok = (await xrSupported('immersive-ar')) || (await xrSupported('immersive-vr'));
  if (!ok) {
    xrBtn.disabled = true;
    syncXR(false, 'Este dispositivo no admite sesiones inmersivas WebXR.');
  } else {
    syncXR(false, 'Compatible: abre la escena en tus gafas o visor WebXR.');
  }
})();

const aspectNow = () => (video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1);
const handDist = (a, b) => Math.hypot((a.x - b.x) * aspectNow(), a.y - b.y);
const handPalm = (L) => handDist(L[0], L[9]) || .1;
const handPinch = (L) => {
  const p = handPalm(L);
  return handDist(L[4], L[8]) < .35 * p && handDist(L[8], L[0]) > 1.2 * p;
};
const handOpen = (L) => (handDist(L[8], L[0]) + handDist(L[12], L[0]) + handDist(L[16], L[0]) + handDist(L[20], L[0])) / 4 / handPalm(L);
const pinchState = new Map();
const handSmooth = new Map();
const rolePrev = { sel: -1 };
const HAND_SMOOTH = .55;

/* Puntos de la mano (landmarks) sobre la imagen de la cámara */
const handCanvas = $('handcanvas');
const handCtx = handCanvas ? handCanvas.getContext('2d') : null;
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

function hideLandmarks() {
  if (handCanvas) handCanvas.style.display = 'none';
}

// Se mantiene activa siempre que la cámara esté encendida; si se apaga, queda oculta.
function drawLandmarks(list, sel, exp) {
  if (!handCanvas || !handCtx) return;
  if (!handOn || vr || renderer.xr.isPresenting) { hideLandmarks(); return; }
  const { w: W, h: H } = viewerSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
  if (handCanvas.width !== cw || handCanvas.height !== ch) {
    handCanvas.width = cw;
    handCanvas.height = ch;
  }
  handCanvas.style.display = 'block';
  handCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  handCtx.clearRect(0, 0, W, H);
  if (!list.length) return;
  list.forEach((L, i) => {
    const tone = i === sel ? '94,242,255' : (i === exp ? '242,0,137' : '255,255,255');
    handCtx.lineWidth = 2;
    handCtx.lineCap = 'round';
    handCtx.strokeStyle = 'rgba(' + tone + ',.5)';
    handCtx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const p = toScreen(L[a].x, L[a].y), q = toScreen(L[b].x, L[b].y);
      handCtx.moveTo(p.x, p.y);
      handCtx.lineTo(q.x, q.y);
    }
    handCtx.stroke();
    handCtx.fillStyle = 'rgba(' + tone + ',.95)';
    for (let k = 0; k < L.length; k++) {
      const p = toScreen(L[k].x, L[k].y);
      handCtx.beginPath();
      handCtx.arc(p.x, p.y, (k === 8 || k === 4 || k === 12) ? 4.4 : 3, 0, Math.PI * 2);
      handCtx.fill();
    }
  });
}

// Suaviza los puntos entre fotogramas para quitar el temblor del cursor y del giro.
// Al cambiar la forma de la mano (p. ej. al entrar otra persona) se reinicia.
function smoothHand(key, L) {
  let s = handSmooth.get(key);
  if (!s || s.length !== L.length) {
    s = L.map((p) => ({ x: p.x, y: p.y }));
    handSmooth.set(key, s);
  } else {
    for (let i = 0; i < L.length; i++) {
      s[i].x += (L[i].x - s[i].x) * HAND_SMOOTH;
      s[i].y += (L[i].y - s[i].y) * HAND_SMOOTH;
    }
  }
  return s;
}

function placeCursor(el, L, idx) {
  const p = toScreen(L[idx].x, L[idx].y);
  el.style.display = 'block';
  el.style.left = p.x + 'px';
  el.style.top = p.y + 'px';
  return p;
}

function hideHandCursors() {
  cursorEl.style.display = 'none';
  cursor2El.style.display = 'none';
  cursorEl.classList.remove('pinch');
  cursor2El.classList.remove('spread');
  hideLandmarks();
}

function processHands() {
  if (!hands || !handOn || vr || renderer.xr.isPresenting || video.readyState < 2 || !video.videoWidth) {
    if (!handOn || vr) { handActive = false; hideHandCursors(); }
    return;
  }
  const now = performance.now();
  if (now - lastDetect < (HAND_THROTTLE_MS || 33)) return;
  lastDetect = now;
  if (video.videoWidth !== vidMap.vw || video.videoHeight !== vidMap.vh) updateVideoMap();
  let res;
  try { res = hands.detectForVideo(video, now); } catch (err) { return; }
  const list = res.landmarks || [];
  if (!list.length) {
    handActive = false;
    hideHandCursors();
    pinchState.clear();
    handSmooth.clear();
    rolePrev.sel = -1;
    return;
  }
  handActive = true;

  const hd = res.handednesses || res.handedness || [];
  const nameOf = (i) => hd[i]?.[0]?.categoryName || ('Mano ' + i);

  // Dos manos: la izquierda elige con pellizco; la derecha separa/junta al abrir o cerrar.
  // Con una sola mano se conserva el control anterior (pellizco + mano abierta).
  // Si las etiquetas no distinguen izquierda/derecha se mantiene el reparto anterior
  // para que los papeles no salten de una mano a otra entre fotogramas.
  let sel = 0, exp = -1, E = null;
  if (list.length > 1) {
    const names = list.map((_, i) => nameOf(i));
    const r = names.indexOf('Right'), l = names.indexOf('Left');
    if (r >= 0 && l >= 0 && r !== l) { sel = l; exp = r; }
    else if (rolePrev.sel >= 0 && rolePrev.sel < list.length) { sel = rolePrev.sel; exp = sel === 0 ? 1 : 0; }
    else { sel = 0; exp = 1; }
    rolePrev.sel = sel;
  } else {
    rolePrev.sel = -1;
  }
  const kept = new Set();
  const { w: W, h: H } = viewerSize();
  const visH = 2 * camZ * Math.tan(25 * Math.PI / 180);
  const visW = visH * (W / H);

  // Mano que elige: el pellizco selecciona la pieza bajo el cursor
  const key = nameOf(sel);
  const L = smoothHand('sel-' + key, list[sel]);
  kept.add('sel-' + key);
  const pi = placeCursor(cursorEl, L, 8);
  const inView = pi.x >= 0 && pi.x <= W && pi.y >= 0 && pi.y <= H;
  const nx = pi.x / W * 2 - 1;
  const ny = -(pi.y / H * 2 - 1);
  const pinch = handPinch(L);
  cursorEl.classList.toggle('pinch', pinch);
  if (pinch && !pinchState.get(key) && inView) {
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hit = ray.intersectObject(cur.group, true).find((h) => h.object.userData.partId);
    if (hit) { ensureAudio(); selectPart(hit.object.userData.partId); }
  }
  pinchState.set(key, pinch);

  // Mano que separa: abrir aleja las piezas y cerrar las junta
  if (exp >= 0) {
    const ekey = nameOf(exp);
    E = smoothHand('exp-' + ekey, list[exp]);
    kept.add('exp-' + ekey);
    placeCursor(cursor2El, E, 9);
    const open = handOpen(E);
    cursor2El.classList.toggle('spread', open > 1.6);
    if (now > expHoldUntil) setExplode((open - 1.15) / .75);
  } else {
    cursor2El.style.display = 'none';
  }

  // Landmarks de todas las manos detectadas (visibles solo con la cámara encendida)
  drawLandmarks(list, sel, exp);

  // Limpia el estado de manos que ya no están en pantalla
  pinchState.forEach((_, k) => { if (!kept.has('sel-' + k)) pinchState.delete(k); });
  handSmooth.forEach((_, k) => { if (!kept.has(k)) handSmooth.delete(k); });

  // Movimiento y giro: con dos manos los lleva la mano derecha (separar); con una sola, la única.
  const moveHand = E || L;
  const canMove = !!E || !pinch;
  const pm = toScreen(moveHand[9].x, moveHand[9].y);
  const mx = pm.x / W * 2 - 1;
  const my = -(pm.y / H * 2 - 1);
  if (canMove) {
    handPos.set(mx * visW * .32, my * visH * .32, 0);
    if (!E && now > expHoldUntil) setExplode((handOpen(L) - 1.15) / .75);
    rotY += (-.42 + mx * .8 - rotY) * .22;
    rotX += (.16 - my * .4 - rotX) * .22;
  }
}

/* ---------- bucle ---------- */
const clock = new THREE.Clock();
let lastHandProcess = 0;
let HAND_THROTTLE_MS = perf ? perf.handThrottle() : (isMobile ? 66 : 50);
let LABEL_EVERY = perf ? perf.labelEvery() : 2;
let DOTS_EVERY = perfLevel() === 'low' ? 6 : (isMobile ? 4 : 3);
function updatePerfTimings() {
  HAND_THROTTLE_MS = perf ? perf.handThrottle() : (isMobile ? 66 : 50);
  LABEL_EVERY = perf ? perf.labelEvery() : 2;
  DOTS_EVERY = perfLevel() === 'low' ? 6 : (isMobile ? 4 : 3);
}
let frameCount = 0, fpsFrames = 0, fpsStamp = performance.now(), lastDraw = 0;

function frame(now) {
  if (!labStarted) return;
  if (!renderer.xr.isPresenting) requestAnimationFrame(frame);

  // Fuera de pantalla no hace falta dibujar: ahorra batería y CPU
  if (!viewerVisible && !vr && !renderer.xr.isPresenting) { clock.getDelta(); return; }

  // Límite de fotogramas elegido en el panel de rendimiento
  const cap = perf ? perf.fpsLimit() : 0;
  if (cap && now - lastDraw < 1000 / cap - 1.5) return;
  lastDraw = now;
  frameCount++;

  const dt = Math.min(clock.getDelta(), .05);
  const t = clock.elapsedTime;

  // Throttle MediaPipe processing
  if (now - lastHandProcess >= HAND_THROTTLE_MS) {
    lastHandProcess = now;
    try { processHands(); } catch (err) {}
  }
  
  const { w: W, h: H } = viewerSize();
  const aspect = W / H;

  if (vr) {
    rotY = gyro.a * .5;
    rotX = (gyro.b - Math.PI / 2) * .5;
  } else if (!handActive && autoRotEl.checked && !reduceMotion) {
    rotY += dt * (rotDial.get() / 100) * 1.6;
  }

  // Suavizado independiente del número de fotogramas (funciona con el límite de FPS)
  const k = 1 - Math.pow(.84, dt * 60);
  const g = cur.group;
  g.rotation.y += (rotY - g.rotation.y) * k;
  g.rotation.x += (rotX - g.rotation.x) * k;
  g.position.lerp(renderer.xr.isPresenting ? XR_POS : (handActive ? handPos : ORIGIN), k);
  const ts = tScale * (cur.zoom || 1) * (renderer.xr.isPresenting ? .6 : 1);
  const sc = g.scale.x + (ts - g.scale.x) * k;
  g.scale.setScalar(sc);

  explode += (explodeTarget - explode) * (1 - Math.pow(.86, dt * 60));
  const e = explode;
  Object.values(cur.parts).forEach((p) => {
    if (!p.obj) return;
    p.obj.position.copy(p.home).addScaledVector(p.dir, e);
  });
  if (!(cur.glb && cur.fx)) {
    try { cur.def.fx(cur, dt, on, t); } catch (err) {}
  }
  if (cur.fx) {
    try { cur.fx(dt, on, t); } catch (err) {}
  }
  g.updateMatrixWorld(true);

  if (!vr && !renderer.xr.isPresenting) {
    camZ = aspect < 1 ? 11.1 / aspect : 11.2;
    camera.aspect = aspect;
    camera.position.set(0, 0, camZ);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // Optimización: actualizar wires solo cuando explode cambia significativamente
  const wireUpdateThreshold = 0.02;
  if (!wireUpdateThreshold || Math.abs(e - (cur._lastExplode || -1)) > wireUpdateThreshold) {
    cur._lastExplode = e;
    const pos = cur.wires.geometry.attributes.position;
    cur.def.wires.forEach(([a, b], i) => {
      [a, b].forEach((id, j) => {
        const o = cur.parts[id]?.obj;
        if (!o) return;
        _b.setFromObject(o).getCenter(_c);
        g.worldToLocal(_c);
        pos.setXYZ(i * 2 + j, _c.x, _c.y, _c.z);
      });
    });
    pos.needsUpdate = true;
  }
  cur.wires.material.color.set(on ? 0xffd76a : 0x8f7bb8);
  cur.wires.material.opacity = on ? .9 : .5;
  cur.wires.visible = e < .42;

  // Dots solo cada pocos frames para reducir cálculos
  if (frameCount % DOTS_EVERY === 0) {
    cur.dotList.forEach((dot, i) => {
      const [a, b] = cur.def.wires[i];
      const oa = cur.parts[a]?.obj;
      const ob = cur.parts[b]?.obj;
      if (!on || !oa || !ob || e > .42) { dot.visible = false; return; }
      dot.visible = true;
      const tt = (t * .55 + i * .33) % 1;
      _b.setFromObject(oa).getCenter(_c);
      g.worldToLocal(_c);
      const ax = _c.x, ay = _c.y, az = _c.z;
      _b.setFromObject(ob).getCenter(_c);
      g.worldToLocal(_c);
      dot.position.set(ax + (_c.x - ax) * tt, ay + (_c.y - ay) * tt, az + (_c.z - az) * tt);
    });
  }

  if (selected && selected.obj) {
    highlight.visible = true;
    highlight.setFromObject(selected.obj);
  } else {
    highlight.visible = false;
  }

  // Optimización: actualizar labels cada pocos frames y solo los visibles
  if (frameCount % LABEL_EVERY === 0) {
    Object.values(cur.parts).forEach((p) => {
      if (!p.obj || vr || renderer.xr.isPresenting || e < .12) { p.label.style.display = 'none'; return; }
      _b.setFromObject(p.obj).getCenter(_c);
      _c.y = _b.max.y + .16;
      _c.project(camera);
      const visible = _c.z < 1;
      p.label.style.display = visible ? 'block' : 'none';
      if (visible) {
        p.label.style.transform = `translate(${(_c.x * .5 + .5) * W}px, ${(-_c.y * .5 + .5) * H}px)`;
      }
    });
    devices.forEach((d) => {
      if (d === cur) return;
      Object.values(d.parts).forEach((p) => { p.label.style.display = 'none'; });
    });
  }

  // Medición de FPS para el panel de rendimiento
  fpsFrames++;
  if (now - fpsStamp >= 500) {
    if (perf) perf.reportFps(fpsFrames * 1000 / (now - fpsStamp));
    fpsFrames = 0;
    fpsStamp = now;
  }

  if (vr) {
    renderer.setScissorTest(true);
    const halfW = W / 2;
    camera.aspect = halfW / H;
    camera.updateProjectionMatrix();
    [-1, 1].forEach((side, i) => {
      camera.position.set(side * .55, 0, camZ * .92);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      renderer.setViewport(i * halfW, 0, halfW, H);
      renderer.setScissor(i * halfW, 0, halfW, H);
      renderer.render(scene, camera);
    });
    renderer.setScissorTest(false);
  } else {
    if (!renderer.xr.isPresenting) renderer.setViewport(0, 0, W, H);
    renderer.setClearColor(0x000000, xrMode === 'immersive-vr' ? 1 : 0);
    renderer.render(scene, camera);
  }
}

/* ---------- arranque diferido ---------- */
function startLab() {
  if (labStarted) return;
  labStarted = true;
  clock.start();
  resize();
  setPower(false, true);
  setExplode(0);
  syncAR();
  requestAnimationFrame(frame);
  // Diferir carga de modelos GLB pesados hasta que el usuario interactúe o tras 3s
  const loadModelsDelayed = () => {
    bootModels();
    document.removeEventListener('pointerdown', loadModelsDelayed);
    document.removeEventListener('keydown', loadModelsDelayed);
  };
  document.addEventListener('pointerdown', loadModelsDelayed, { once: true, passive: true });
  document.addEventListener('keydown', loadModelsDelayed, { once: true, passive: true });
  setTimeout(loadModelsDelayed, 3000);
}
window.__startLab = startLab;
if (window.__labStartRequested) startLab();
