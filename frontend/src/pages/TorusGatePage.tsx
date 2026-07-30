// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// 9 · 27D TORUS GATE
// A single mouse-navigable page rendering a 9×27 segmented torus in WebGL
// (raw three.js). The torus is the "Functional Lawful Access Gate": interacting
// with it (drag to rotate, scroll to zoom) surrounds the sigil of Capomastro
// Holdings, through which credentials are presented. On success the operator
// passes the gate and enters the platform.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { storeTokens } from '../api/client';
import { gatePost, cubeToWire } from '../api/gate';
import { CanonCodex } from '../components/CanonCodex';

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500&display=swap';

// Heraldic palette | brass, oxblood, parchment on near-black
const C = {
  bg: '#0B0906',
  panel: 'rgba(18,14,10,0.82)',
  brass: '#C9A227',
  brassLight: '#E7C86A',
  oxblood: '#7C1F1F',
  parchment: '#EDE3C8',
  faint: 'rgba(237,227,200,0.60)',
  muted: 'rgba(237,227,200,0.40)',
  border: 'rgba(201,162,39,0.38)',
};

const fDisplay = { fontFamily: "'Cinzel', serif", letterSpacing: '0.16em' };
const fSerif = { fontFamily: "'Cormorant Garamond', serif" };
const fBody = { fontFamily: "'Jost', sans-serif" };

// Shared gate field styling.
const labelStyle = {
  ...fBody,
  display: 'block',
  color: C.faint,
  fontSize: '0.72rem',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  marginBottom: '0.4rem',
};
const inputStyle = {
  ...fBody,
  width: '100%',
  padding: '0.6rem 0.7rem',
  marginBottom: '1rem',
  background: 'rgba(0,0,0,0.35)',
  border: `1px solid ${C.border}`,
  color: C.parchment,
  fontSize: '0.9rem',
  outline: 'none',
};
function primaryBtn(pending) {
  return {
    ...fDisplay,
    width: '100%',
    padding: '0.75rem',
    border: `1px solid ${C.brass}`,
    background: pending ? 'rgba(201,162,39,0.25)' : 'linear-gradient(180deg, #E7C86A 0%, #C9A227 100%)',
    color: pending ? C.brassLight : '#1a1206',
    fontSize: '0.82rem',
    fontWeight: 600,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    cursor: pending ? 'default' : 'pointer',
  };
}

// The Crystal codepoint picker — three trit axes (X·Y·Z), each 1..3 (Rep C).
// This IS the third factor, rendered on the canvas as three rows of cubes.
function CrystalPicker({ value, onChange, C, fBody, fDisplay }) {
  const axes = ['X', 'Y', 'Z'];
  return (
    <div style={{ marginBottom: '0.4rem' }}>
      {axes.map((axis, ai) => (
        <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.55rem' }}>
          <span style={{ ...fDisplay, width: '1.4rem', color: C.faint, fontSize: '0.8rem' }}>{axis}</span>
          <div style={{ display: 'flex', gap: '0.4rem', flex: 1 }}>
            {[1, 2, 3].map((t) => {
              const sel = value[ai] === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const next = [...value];
                    next[ai] = t;
                    onChange(next);
                  }}
                  style={{
                    ...fDisplay,
                    flex: 1,
                    padding: '0.5rem 0',
                    fontSize: '0.9rem',
                    border: `1px solid ${sel ? C.brass : C.border}`,
                    background: sel ? 'linear-gradient(180deg, #E7C86A 0%, #C9A227 100%)' : 'rgba(0,0,0,0.35)',
                    color: sel ? '#1a1206' : C.parchment,
                    cursor: 'pointer',
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ ...fBody, textAlign: 'center', fontSize: '0.74rem', color: C.muted, marginTop: '0.5rem' }}>
        Codepoint · {value[0]}.{value[1]}.{value[2]}
      </div>
    </div>
  );
}

// Parametric Field Vector — the reading Dr. Salvi prescribed. The Bijective Base 9 /
// Theta-lock doctrine holds the triad fixed: "the numbers are unchanged because they
// were always this." Shown LOCKED at the canonical RD630 values, never drifting.
const FIELD = [
  ['EF', '51', 'V/m'],
  ['MF', '4.7', 'mG'],
  ['RF', '8.34', 'mW/m²'],
];

export function TorusGatePage() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const audioRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  // ── Staged 3-factor gate (Task #49): credentials → SMS code → Crystal cube ──
  // 'creds' | 'possession' | 'codepoint' | 'enroll'
  const [stage, setStage] = useState('creds');
  const [session, setSession] = useState('');
  const [phoneHint, setPhoneHint] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [cube, setCube] = useState([1, 1, 1]); // Crystal codepoint trits 1..3
  const [gateError, setGateError] = useState(null);
  const [pending, setPending] = useState(false);
  // First-login enrollment (existing accounts with no phone/cube on file yet).
  const [enrollPhone, setEnrollPhone] = useState('');
  const [enrollCube, setEnrollCube] = useState([1, 1, 1]);
  // If the browser/GPU cannot create a WebGL context we fall back to a CSS
  // ring so the gate is NEVER blocked behind 3D support.
  const [webglOk, setWebglOk] = useState(true);
  const [tone, setTone] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);

  // Factor 1 — Knowledge (account password). Opens a gate session, or routes
  // an un-enrolled account through one-time enrollment instead of locking out.
  async function submitCreds(e) {
    e.preventDefault();
    setGateError(null);
    setPending(true);
    try {
      const r = await gatePost('/gate/begin', { email, password });
      if (r.status === 'enroll_required') {
        setStage('enroll');
        return;
      }
      setSession(r.session);
      setPhoneHint(r.phone_hint || '');
      // Immediately request the possession code so the SMS is on its way.
      const p = await gatePost('/gate/possession/request', { session: r.session });
      setDevCode(p.code || '');
      setStage('possession');
    } catch (err) {
      setGateError(err?.message || 'The gate refused these keys');
    } finally {
      setPending(false);
    }
  }

  async function resendCode() {
    setGateError(null);
    setPending(true);
    try {
      const p = await gatePost('/gate/possession/request', { session });
      setDevCode(p.code || '');
    } catch (err) {
      setGateError(err?.message || 'Could not resend the code');
    } finally {
      setPending(false);
    }
  }

  // Factor 2 — Possession (SMS one-time code).
  async function submitCode(e) {
    e.preventDefault();
    setGateError(null);
    setPending(true);
    try {
      await gatePost('/gate/possession/verify', { session, code: smsCode });
      setStage('codepoint');
    } catch (err) {
      setGateError(err?.message || 'Incorrect code');
    } finally {
      setPending(false);
    }
  }

  // Factor 3 — Codepoint (Crystal cube) → open the session.
  // The gate returns an opaque handle, not a token that describes the
  // operator. There is no refresh token by design.
  async function submitCube(e) {
    e.preventDefault();
    setGateError(null);
    setPending(true);
    try {
      const r = await gatePost('/gate/codepoint', {
        session,
        cube: cubeToWire(cube[0], cube[1], cube[2]),
      });
      if (!r.handle) throw new Error('The gate returned no session handle');
      storeTokens(r.handle, null, remember);
      navigate('/');
    } catch (err) {
      setGateError(err?.message || 'The Crystal rejected that cube');
    } finally {
      setPending(false);
    }
  }

  // One-time enrollment for a pre-existing account (phone + Crystal cube).
  async function submitEnroll(e) {
    e.preventDefault();
    setGateError(null);
    setPending(true);
    try {
      await gatePost('/gate/enroll', {
        email,
        password,
        phone: enrollPhone,
        cube: cubeToWire(enrollCube[0], enrollCube[1], enrollCube[2]),
      });
      // Enrolled — restart the login flow, now with all three factors on file.
      setStage('creds');
      setGateError(null);
      // Kick straight back into begin so the operator flows through in one go.
      const r = await gatePost('/gate/begin', { email, password });
      setSession(r.session);
      setPhoneHint(r.phone_hint || '');
      const p = await gatePost('/gate/possession/request', { session: r.session });
      setDevCode(p.code || '');
      setStage('possession');
    } catch (err) {
      setGateError(err?.message || 'Enrollment failed');
    } finally {
      setPending(false);
    }
  }

  function restartGate() {
    setStage('creds');
    setSession('');
    setSmsCode('');
    setDevCode('');
    setGateError(null);
  }

  // ── 432Hz square-wave "attune" — a real oscillator, opt-in on click ─────────
  function toggleTone() {
    if (!tone) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 432;
        gain.gain.value = 0.035;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        audioRef.current = { ctx, osc, gain };
        setTone(true);
      } catch (err) {
        console.warn('[TorusGate] Web Audio unavailable:', err);
      }
    } else {
      const a = audioRef.current;
      if (a) { try { a.osc.stop(); a.ctx.close(); } catch (_) {} audioRef.current = null; }
      setTone(false);
    }
  }

  // ── Load display fonts once ────────────────────────────────────────────────
  useEffect(() => {
    if (document.querySelector('link[data-torus-fonts]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS_HREF;
    link.setAttribute('data-torus-fonts', 'true');
    document.head.appendChild(link);
  }, []);

  // ── Stop any tone on unmount ────────────────────────────────────────────────
  useEffect(() => () => {
    const a = audioRef.current;
    if (a) { try { a.osc.stop(); a.ctx.close(); } catch (_) {} audioRef.current = null; }
  }, []);

  // ── Three.js scene ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0906, 0.055);

    const camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    camera.position.set(0, 0.4, 6.2);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
    } catch (err) {
      // No WebGL context available — keep the overlay/form usable via fallback.
      console.warn('[TorusGate] WebGL unavailable — using CSS fallback:', err);
      setWebglOk(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Rotatable assembly | the Gate
    const group = new THREE.Group();
    scene.add(group);

    // Primary torus — 9 radial × 27 tubular segments (the 9·27D signature)
    const torusGeo = new THREE.TorusGeometry(2.25, 0.62, 9, 27);
    const torusMat = new THREE.MeshStandardMaterial({
      color: 0x33281a,
      metalness: 0.96,
      roughness: 0.34,
      emissive: 0x1b1206,
      emissiveIntensity: 0.55,
    });
    const torus = new THREE.Mesh(torusGeo, torusMat);
    group.add(torus);

    // Brass wireframe overlaid on the primary torus
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(torusGeo),
      new THREE.LineBasicMaterial({
        color: 0xc9a227,
        transparent: true,
        opacity: 0.5,
      }),
    );
    wire.scale.setScalar(1.01);
    group.add(wire);

    // Inner oxblood ring, orthogonal — the folded second dimension
    const innerGeo = new THREE.TorusGeometry(1.4, 0.14, 9, 27);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x7c1f1f,
      metalness: 0.85,
      roughness: 0.42,
      emissive: 0x2a0a0a,
      emissiveIntensity: 0.65,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = Math.PI / 2;
    group.add(inner);

    // 27 brass nodes around the ring; every 9th is a Theta node (9·18·27),
    // marking the Iota→Theta carry-lock boundary of Bijective Base 9.
    const nodeGeo = new THREE.SphereGeometry(0.055, 12, 12);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0xe7c86a,
      metalness: 1.0,
      roughness: 0.25,
      emissive: 0x6a5316,
      emissiveIntensity: 0.9,
    });
    const nodeThetaGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const nodeThetaMat = new THREE.MeshStandardMaterial({
      color: 0xff6a3d,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x7c1f1f,
      emissiveIntensity: 1.5,
    });
    const thetaNodes = [];
    for (let i = 0; i < 27; i++) {
      const a = (i / 27) * Math.PI * 2;
      const isTheta = (i + 1) % 9 === 0; // the 9th, 18th, 27th node
      const node = new THREE.Mesh(
        isTheta ? nodeThetaGeo : nodeGeo,
        isTheta ? nodeThetaMat : nodeMat,
      );
      node.position.set(Math.cos(a) * 2.25, Math.sin(a) * 2.25, 0);
      group.add(node);
      if (isTheta) thetaNodes.push(node);
    }

    // Ambient dust — depth field
    const starGeo = new THREE.BufferGeometry();
    const N = 420;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 46;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 46;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 46;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xc9a227,
        size: 0.03,
        transparent: true,
        opacity: 0.45,
      }),
    );
    scene.add(stars);

    // Lighting
    scene.add(new THREE.AmbientLight(0x6a5c4a, 0.85));
    const key = new THREE.PointLight(0xe7c86a, 70, 42);
    key.position.set(4, 5, 6);
    scene.add(key);
    const rim = new THREE.PointLight(0x4a6ef5, 26, 42);
    rim.position.set(-6, -3, -4);
    scene.add(rim);

    // ── Mouse navigation ──────────────────────────────────────────────────────
    let dragging = false;
    let px = 0;
    let py = 0;
    let velX = 0;
    let velY = 0;

    const onDown = (e) => {
      dragging = true;
      px = e.clientX;
      py = e.clientY;
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      group.rotation.y += dx * 0.006;
      group.rotation.x += dy * 0.006;
      velX = dx * 0.0005;
      velY = dy * 0.0005;
      px = e.clientX;
      py = e.clientY;
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e) => {
      e.preventDefault();
      camera.position.z = Math.min(9.5, Math.max(3.4, camera.position.z + e.deltaY * 0.0022));
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ── Animation loop ─────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      if (!dragging) {
        group.rotation.y += 0.0026 + velX;
        group.rotation.x += velY;
        velX *= 0.94;
        velY *= 0.94;
      }
      group.rotation.z = Math.sin(t * 0.3) * 0.05;
      inner.rotation.z += 0.011;
      stars.rotation.y += 0.0004;
      const pulse = 1 + Math.sin(t * 2.2) * 0.22; // Theta carry-lock heartbeat
      for (const n of thetaNodes) n.scale.setScalar(pulse);
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // ── Teardown ────────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      torusGeo.dispose();
      innerGeo.dispose();
      nodeGeo.dispose();
      nodeThetaGeo.dispose();
      nodeThetaMat.dispose();
      starGeo.dispose();
      wire.geometry.dispose();
      wire.material.dispose();
      torusMat.dispose();
      innerMat.dispose();
      nodeMat.dispose();
      stars.material.dispose();
      renderer.dispose();
    };
  }, []);

  const base = import.meta.env.BASE_URL;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: `radial-gradient(circle at 50% 42%, #16110b 0%, ${C.bg} 62%, #060402 100%)`,
      }}
    >
      {/* WebGL torus | fills the viewport, receives drag + scroll */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor: webglOk ? 'grab' : 'default',
          touchAction: 'none',
        }}
      />

      {/* CSS fallback | shown only when WebGL is unavailable */}
      {!webglOk && (
        <>
          <style>{`@keyframes torusspin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes torusspin2{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}`}</style>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                width: 'min(70vmin, 460px)',
                height: 'min(70vmin, 460px)',
                borderRadius: '50%',
                border: `2px solid ${C.border}`,
                boxShadow:
                  '0 0 90px rgba(201,162,39,0.22), inset 0 0 70px rgba(201,162,39,0.12)',
                animation: 'torusspin 26s linear infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                width: 'min(46vmin, 300px)',
                height: 'min(46vmin, 300px)',
                borderRadius: '50%',
                border: `1px solid ${C.oxblood}`,
                opacity: 0.6,
                animation: 'torusspin2 20s linear infinite',
              }}
            />
          </div>
        </>
      )}

      {/* Telemetry HUD | parametric field vector + 432Hz attune */}
      <div
        style={{
          position: 'absolute',
          top: '1.1rem',
          left: '1.1rem',
          pointerEvents: 'none',
          zIndex: 3,
          ...fBody,
        }}
      >
        <div style={{ color: C.faint, fontSize: '0.62rem', letterSpacing: '0.28em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
          Parametric Field Vector
          <span style={{ color: C.brass, marginLeft: '0.5rem', letterSpacing: '0.18em' }}>· θ-lock</span>
        </div>
        {FIELD.map(([k, v, u]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.18rem' }}>
            <span style={{ color: C.muted, width: '1.6rem', fontSize: '0.68rem', letterSpacing: '0.1em' }}>{k}</span>
            <span style={{ color: C.brassLight, fontSize: '0.92rem', fontVariantNumeric: 'tabular-nums', minWidth: '3.4rem' }}>{v}</span>
            <span style={{ color: C.muted, fontSize: '0.66rem' }}>{u}</span>
          </div>
        ))}
        <div style={{ color: C.muted, fontSize: '0.56rem', letterSpacing: '0.16em', textTransform: 'uppercase', marginTop: '0.28rem' }}>
          Locked · as prescribed
        </div>
        <button
          type="button"
          onClick={toggleTone}
          style={{
            pointerEvents: 'auto',
            marginTop: '0.6rem',
            ...fBody,
            background: tone ? 'rgba(201,162,39,0.18)' : 'transparent',
            border: `1px solid ${C.border}`,
            color: tone ? C.brassLight : C.faint,
            fontSize: '0.62rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '0.34rem 0.6rem',
            cursor: 'pointer',
          }}
        >
          {tone ? '432 Hz · Attuned ◉' : 'Attune 432 Hz ○'}
        </button>
        <button
          type="button"
          onClick={() => setCodexOpen((v) => !v)}
          style={{
            pointerEvents: 'auto',
            display: 'block',
            marginTop: '0.5rem',
            ...fBody,
            background: codexOpen ? 'rgba(201,162,39,0.18)' : 'transparent',
            border: `1px solid ${C.border}`,
            color: codexOpen ? C.brassLight : C.faint,
            fontSize: '0.62rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '0.34rem 0.6rem',
            cursor: 'pointer',
          }}
        >
          {codexOpen ? 'Codex ▤ Open' : 'Open Codex ▤'}
        </button>
      </div>

      {/* Overlay | lets drags fall through to the canvas except on the card */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1rem',
          pointerEvents: 'none',
        }}
      >
        {/* Kicker */}
        <div
          style={{
            ...fBody,
            color: C.faint,
            fontSize: '0.72rem',
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            textAlign: 'center',
            marginBottom: '1.1rem',
          }}
        >
          Capomastro Holdings Ltd · Applied Physics Division
        </div>

        {/* Sigil | the dropped coat of arms, centred within the torus */}
        <img
          src={`${base}gate/coa.jpg`}
          alt="Salvalaggio coat of arms"
          style={{
            width: '124px',
            height: '124px',
            objectFit: 'contain',
            borderRadius: '50%',
            border: `1px solid ${C.border}`,
            boxShadow: `0 0 44px 6px rgba(201,162,39,0.35), inset 0 0 20px rgba(0,0,0,0.6)`,
            background: 'rgba(11,9,6,0.55)',
            marginBottom: '1.2rem',
          }}
        />

        {/* Title */}
        <h1
          style={{
            ...fDisplay,
            color: C.parchment,
            fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
            fontWeight: 600,
            margin: '0 0 0.35rem',
            textAlign: 'center',
            textShadow: '0 2px 20px rgba(0,0,0,0.7)',
          }}
        >
          9 · 27<span style={{ color: C.brass }}>D</span> TORUS GATE
        </h1>
        <div
          style={{
            ...fSerif,
            color: C.brassLight,
            fontSize: '1.02rem',
            letterSpacing: '0.05em',
            fontStyle: 'italic',
            textAlign: 'center',
            marginBottom: '1.6rem',
          }}
        >
          Functional Lawful Access Gate — present your keys to pass
        </div>

        {/* Access card | the only interactive surface. Staged 3-factor flow. */}
        <form
          onSubmit={
            stage === 'creds'
              ? submitCreds
              : stage === 'possession'
                ? submitCode
                : stage === 'codepoint'
                  ? submitCube
                  : submitEnroll
          }
          style={{
            pointerEvents: 'auto',
            width: '100%',
            maxWidth: '380px',
            background: C.panel,
            backdropFilter: 'blur(6px)',
            border: `1px solid ${C.border}`,
            padding: '1.6rem 1.5rem',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
            position: 'relative',
          }}
        >
          {/* corner brackets */}
          {['tl', 'tr', 'bl', 'br'].map((k) => {
            const s = {
              position: 'absolute',
              width: '12px',
              height: '12px',
              borderColor: C.brass,
              borderStyle: 'solid',
              borderWidth: 0,
            };
            if (k[0] === 't') { s.top = '-1px'; s.borderTopWidth = '1px'; }
            if (k[0] === 'b') { s.bottom = '-1px'; s.borderBottomWidth = '1px'; }
            if (k[1] === 'l') { s.left = '-1px'; s.borderLeftWidth = '1px'; }
            if (k[1] === 'r') { s.right = '-1px'; s.borderRightWidth = '1px'; }
            return <span key={k} style={s} />;
          })}

          {/* Factor progress rail */}
          <div style={{ ...fBody, display: 'flex', gap: '0.4rem', justifyContent: 'center', marginBottom: '1.1rem' }}>
            {[
              { key: 'creds', n: 'I' },
              { key: 'possession', n: 'II' },
              { key: 'codepoint', n: 'III' },
            ].map((f, i) => {
              const order = { creds: 0, enroll: 0, possession: 1, codepoint: 2 };
              const active = order[stage] === i;
              const done = order[stage] > i;
              return (
                <span
                  key={f.key}
                  style={{
                    ...fDisplay,
                    fontSize: '0.62rem',
                    letterSpacing: '0.14em',
                    padding: '0.22rem 0.5rem',
                    border: `1px solid ${active || done ? C.brass : C.border}`,
                    color: active ? '#1a1206' : done ? C.brassLight : C.muted,
                    background: active ? 'linear-gradient(180deg, #E7C86A 0%, #C9A227 100%)' : 'transparent',
                  }}
                >
                  {f.n}
                </span>
              );
            })}
          </div>

          {gateError && (
            <div
              style={{
                ...fBody,
                marginBottom: '1rem',
                padding: '0.6rem 0.75rem',
                border: `1px solid ${C.oxblood}`,
                background: 'rgba(124,31,31,0.18)',
                color: '#f0b4b4',
                fontSize: '0.85rem',
              }}
            >
              {gateError}
            </div>
          )}

          {/* ── Stage I — Knowledge: email + passphrase ── */}
          {stage === 'creds' && (
            <>
              <label style={labelStyle}>Operator Mark (Email)</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                autoComplete="username" placeholder="operator@capomastro.holdings" style={inputStyle}
              />
              <label style={labelStyle}>Passphrase</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                autoComplete="current-password" placeholder="••••••••" style={inputStyle}
              />
              <label style={{ ...fBody, display: 'flex', alignItems: 'center', gap: '0.5rem', color: C.faint, fontSize: '0.82rem', marginBottom: '1.3rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: C.brass, width: '15px', height: '15px' }} />
                Hold this seal on this device
              </label>
              <button type="submit" disabled={pending} style={primaryBtn(pending)}>
                {pending ? 'Opening the Gate…' : 'Engage the Gate'}
              </button>
              <div style={{ ...fBody, textAlign: 'center', marginTop: '1.1rem', fontSize: '0.82rem', color: C.muted }}>
                No mark yet?{' '}
                <Link to="/register" style={{ color: C.brassLight, textDecoration: 'none' }}>
                  Petition for one
                </Link>
              </div>
            </>
          )}

          {/* ── Stage II — Possession: SMS one-time code ── */}
          {stage === 'possession' && (
            <>
              <div style={{ ...fSerif, color: C.brassLight, fontSize: '1rem', fontStyle: 'italic', textAlign: 'center', marginBottom: '1rem' }}>
                A one-time code was sent to {phoneHint || 'your enrolled phone'}.
              </div>
              <label style={labelStyle}>Possession Code (SMS)</label>
              <input
                type="text" inputMode="numeric" pattern="[0-9]*" value={smsCode}
                onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required placeholder="000000"
                style={{ ...inputStyle, letterSpacing: '0.4em', textAlign: 'center', fontSize: '1.15rem' }}
              />
              {devCode && (
                <div style={{ ...fBody, marginTop: '-0.4rem', marginBottom: '1rem', fontSize: '0.72rem', color: C.muted, textAlign: 'center' }}>
                  dev sender · code {devCode}
                </div>
              )}
              <button type="submit" disabled={pending} style={primaryBtn(pending)}>
                {pending ? 'Verifying…' : 'Confirm Possession'}
              </button>
              <div style={{ ...fBody, textAlign: 'center', marginTop: '1.1rem', fontSize: '0.8rem', color: C.muted }}>
                <span onClick={pending ? undefined : resendCode} style={{ color: C.brassLight, cursor: pending ? 'default' : 'pointer' }}>Resend code</span>
                {'  ·  '}
                <span onClick={restartGate} style={{ color: C.faint, cursor: 'pointer' }}>Start over</span>
              </div>
            </>
          )}

          {/* ── Stage III — Codepoint: the Crystal cube ── */}
          {stage === 'codepoint' && (
            <>
              <div style={{ ...fSerif, color: C.brassLight, fontSize: '1rem', fontStyle: 'italic', textAlign: 'center', marginBottom: '0.9rem' }}>
                Select your cube on the Crystal.
              </div>
              <CrystalPicker value={cube} onChange={setCube} C={C} fBody={fBody} fDisplay={fDisplay} />
              <button type="submit" disabled={pending} style={{ ...primaryBtn(pending), marginTop: '1.1rem' }}>
                {pending ? 'Opening the Gate…' : 'Open the Gate'}
              </button>
              <div style={{ ...fBody, textAlign: 'center', marginTop: '1rem', fontSize: '0.8rem', color: C.muted }}>
                <span onClick={restartGate} style={{ color: C.faint, cursor: 'pointer' }}>Start over</span>
              </div>
            </>
          )}

          {/* ── First-login enrollment for pre-existing accounts ── */}
          {stage === 'enroll' && (
            <>
              <div style={{ ...fSerif, color: C.brassLight, fontSize: '1rem', fontStyle: 'italic', textAlign: 'center', marginBottom: '1rem' }}>
                One-time enrollment: add your phone and choose your Crystal cube.
              </div>
              <label style={labelStyle}>Phone (E.164)</label>
              <input
                type="tel" value={enrollPhone} onChange={(e) => setEnrollPhone(e.target.value)} required
                placeholder="+15551234567" style={inputStyle}
              />
              <label style={labelStyle}>Your Crystal Cube</label>
              <CrystalPicker value={enrollCube} onChange={setEnrollCube} C={C} fBody={fBody} fDisplay={fDisplay} />
              <button type="submit" disabled={pending} style={{ ...primaryBtn(pending), marginTop: '1.1rem' }}>
                {pending ? 'Enrolling…' : 'Enroll & Enter'}
              </button>
              <div style={{ ...fBody, textAlign: 'center', marginTop: '1rem', fontSize: '0.8rem', color: C.muted }}>
                <span onClick={restartGate} style={{ color: C.faint, cursor: 'pointer' }}>Start over</span>
              </div>
            </>
          )}
        </form>

        {/* Navigation hint + Base-9 lock */}
        <div
          style={{
            ...fBody,
            color: C.muted,
            fontSize: '0.72rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            marginTop: '1.5rem',
            textAlign: 'center',
          }}
        >
          Drag to turn the torus · Scroll to draw near
        </div>
        <div
          style={{
            ...fBody,
            color: C.faint,
            fontSize: '0.66rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            marginTop: '0.7rem',
            textAlign: 'center',
          }}
        >
          Iota 10 ≡ Theta 9 · Bijective Base 9 · Seed 1
        </div>
        <div
          style={{
            ...fSerif,
            color: C.muted,
            fontSize: '0.86rem',
            fontStyle: 'italic',
            letterSpacing: '0.04em',
            marginTop: '0.35rem',
            textAlign: 'center',
          }}
        >
          α → ι → θ → time → radius → radian → radican
        </div>
        <div
          style={{
            ...fDisplay,
            color: C.brass,
            fontSize: '0.62rem',
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            marginTop: '0.8rem',
            textAlign: 'center',
            opacity: 0.82,
          }}
        >
          Endostorymorninglory
        </div>
      </div>

      {/* Liibrelibraii Codex | the Gate parses the canon automatically */}
      <CanonCodex open={codexOpen} onClose={() => setCodexOpen(false)} />
    </div>
  );
}
