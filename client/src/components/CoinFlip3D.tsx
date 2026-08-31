import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './CoinFlip3D.css';

const FLIP_MS = 2800;
const SPINS = 11;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function stampTexture(label: string, fill: string, ink: string): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 18;
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 96px "Cinzel", "Times New Roman", serif';
  ctx.fillText(label, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

interface Props {
  outcome: 'Win' | 'Lose';
  onLanded: () => void;
}

export default function CoinFlip3D({ outcome, onLanded }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const onLandedRef = useRef(onLanded);
  useEffect(() => {
    onLandedRef.current = onLanded;
  }, [onLanded]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let disposed = false;
    let frameId = 0;
    const width = wrap.clientWidth || 520;
    const height = wrap.clientHeight || 520;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 40);
    camera.position.set(0, 0.35, 5.4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    wrap.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xfff3d0, 0.7));
    const key = new THREE.DirectionalLight(0xffe7a8, 2.1);
    key.position.set(-2.4, 3.2, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.55);
    rim.position.set(3, -1, -2);
    scene.add(rim);

    const winTex = stampTexture('WIN', '#c9a227', '#1a1204');
    const loseTex = stampTexture('LOSE', '#8a1c16', '#f3d2c8');
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0xb8891c,
      metalness: 0.92,
      roughness: 0.28,
    });
    const winMat = new THREE.MeshStandardMaterial({
      map: winTex,
      metalness: 0.55,
      roughness: 0.35,
    });
    const loseMat = new THREE.MeshStandardMaterial({
      map: loseTex,
      metalness: 0.55,
      roughness: 0.35,
    });

    const geo = new THREE.CylinderGeometry(1.35, 1.35, 0.16, 64);
    const coin = new THREE.Mesh(geo, [sideMat, winMat, loseMat]);
    coin.rotation.x = -Math.PI / 2;

    const toss = new THREE.Group();
    toss.add(coin);
    scene.add(toss);

    const land = outcome === 'Win' ? 0 : Math.PI;
    const total = SPINS * Math.PI * 2 + land;
    const started = performance.now();
    let landed = false;
    const landNow = () => {
      if (landed || disposed) return;
      landed = true;
      onLandedRef.current();
    };

    const tick = (now: number) => {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);
      const t = Math.min(1, (now - started) / FLIP_MS);
      const eased = easeOutCubic(t);
      toss.rotation.x = total * eased;
      toss.rotation.z = Math.sin(eased * Math.PI) * 0.28;
      toss.position.y = Math.sin(eased * Math.PI) * 1.15;
      renderer.render(scene, camera);
      if (t >= 1) landNow();
    };
    frameId = requestAnimationFrame(tick);
    const failSafe = window.setTimeout(landNow, FLIP_MS + 400);

    return () => {
      disposed = true;
      window.clearTimeout(failSafe);
      cancelAnimationFrame(frameId);
      renderer.dispose();
      geo.dispose();
      winTex.dispose();
      loseTex.dispose();
      sideMat.dispose();
      winMat.dispose();
      loseMat.dispose();
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement);
    };
  }, [outcome]);

  return <div ref={wrapRef} className="battle-coin-canvas" data-testid="battle-coin-flip" />;
}
