import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { heroPortraitUrl } from '../utils/heroIcon';

// Real 3D model for the Tapalka widget (Blueprint/10-tech-debt-backlog.md,
// "Анимированные портреты / 3D-модели"). Source: pissang/dota2hero (GitHub),
// assets mirrored into public/models/brewmaster/ rather than hotlinked at
// runtime — a third-party raw.githubusercontent.com fetch on every widget
// mount isn't something to depend on for a live feature (rate limits,
// uptime, latency), and the files are small enough (~880KB total) to ship
// with the app. Same accepted-risk posture as the rest of the project's
// Dota assets (Blueprint/10-tech-debt-backlog.md, "Тапалка" /
// "Анимированные портреты" — Valve's fan-content terms are strictly
// non-commercial, conflicts with ad monetization once that goes live,
// explicitly deferred by the user).
//
// No skeletal animation — the glTF ships mesh/skin/material data but no
// animation clips; the source repo's actual animations are raw Source-engine
// .smd files (see animations.json alongside the model), not glTF clips, so
// playing them would need a from-scratch SMD parser plus unverified bone
// mapping onto this skeleton (flagged in TapalkaWidget.tsx's own comment as
// out of scope for a UI pass). This renders the model in its baked rest
// pose instead, with a gentle idle wobble standing in for "alive" motion,
// plus a faster full spin during the click "drink" sequence — genuinely 3D,
// just not skeletally animated.
//
// The bind pose itself isn't a neutral T-pose — the weapon (a long
// staff-like flail, rigged to the right wrist) hangs straight down at the
// model's front-facing angle (rotation.y=0), reading as centered between
// the legs from head-on (Blueprint/10-tech-debt-backlog.md, "Тапалка —
// 3D-модель стоит в некрасивой позе", direct user report). Reposing it by
// rotating the arm/weapon bones was tried and rejected — this skeleton's
// skinning doesn't tolerate an isolated joint rotation cleanly (the mesh
// visibly tore/ballooned even at a small angle on the shoulder bone,
// screenshotted via a temporary WebGL readPixels capture during
// development) — safe to assume the same for any other single bone in this
// chain without much more investigation than a UI pass warrants. Fixed
// instead by never resting (or wobbling into) the bad viewing angle:
// REST_ROTATION_Y offsets the model to a facing where the weapon reads as
// held at the character's side rather than centered (checked visually
// across the 100-150° range, all acceptable); IDLE_WOBBLE_* keeps the idle
// motion within that same safe arc instead of doing a full turntable that
// would cycle back through 0° every rotation. The brief full-speed spin on
// click (DRINK_SPIN_RADIANS_PER_SEC) can still pass through the bad angle,
// but it's fast and momentary rather than a resting pose, same tradeoff the
// backlog accepted as fine.
const MODEL_URL = '/models/brewmaster/brewmaster.gltf';
const FALLBACK_HERO_ID = 78; // Brewmaster — used only if the 3D asset fails to load.

const REST_ROTATION_Y = (130 * Math.PI) / 180;
const IDLE_WOBBLE_AMPLITUDE_RADIANS = (18 * Math.PI) / 180;
const IDLE_WOBBLE_RADIANS_PER_SEC = 0.5;
const DRINK_SPIN_RADIANS_PER_SEC = 4.5;

interface Props {
  drinking: boolean;
  width: number;
  height: number;
}

export default function TapalkaModel3D({ drinking, width, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drinkingRef = useRef(drinking);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    drinkingRef.current = drinking;
  }, [drinking]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    let model: THREE.Object3D | null = null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, width / height, 1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xfff2d9, 1.1));
    const key = new THREE.DirectionalLight(0xffe6b0, 1.4);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb0ff, 0.6);
    rim.position.set(-3, 1, -2);
    scene.add(rim);

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;

        // Frame the model: center it and back the camera off by its
        // longest dimension, independent of whatever units/scale the
        // source FBX->glTF export used.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        // The source rig's baked rest pose isn't a neutral T-pose (limbs
        // extended at odd angles, see TapalkaModel3D module comment) — pull
        // back further than a tightly-fit "radius" would need for a
        // standing pose, so a raised arm/extended leg doesn't clip the
        // frame edges across the idle wobble's range or the drink click's
        // full spin.
        const radius = Math.max(size.x, size.y, size.z) / 2 || 1;
        camera.position.set(0, size.y * 0.05, radius * 3.6);
        camera.lookAt(0, 0, 0);

        model.rotation.y = REST_ROTATION_Y;
        scene.add(model);
      },
      undefined,
      () => {
        if (!disposed) setFailed(true);
      },
    );

    const clock = new THREE.Clock();
    let elapsed = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      elapsed += delta;
      if (model) {
        if (drinkingRef.current) {
          model.rotation.y += DRINK_SPIN_RADIANS_PER_SEC * delta;
        } else {
          model.rotation.y = REST_ROTATION_Y + IDLE_WOBBLE_AMPLITUDE_RADIANS * Math.sin(elapsed * IDLE_WOBBLE_RADIANS_PER_SEC);
        }
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of materials) {
            mat.map?.dispose();
            mat.dispose();
          }
        }
      });
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
    // width/height are fixed props for this widget (not resized at runtime)
    // — intentionally excluded so a re-render never tears down the WebGL
    // context, only `drinking` changes read live via drinkingRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <img
        src={heroPortraitUrl(FALLBACK_HERO_ID)}
        alt="Brewmaster"
        width={width}
        height={height}
        className="tapalka-portrait"
      />
    );
  }

  return <div ref={containerRef} className="tapalka-model3d" style={{ width, height }} />;
}
