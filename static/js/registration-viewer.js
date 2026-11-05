import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

const viewer = document.getElementById("registration-viewer");
const canvas = document.getElementById("registration-canvas");
const status = document.getElementById("viewer-status");
const selector = document.getElementById("sample-select");
const loader = new PLYLoader();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111827);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setClearColor(0x111827, 1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
controls.autoRotateSpeed = 0.45;

const pointGroup = new THREE.Group();
scene.add(pointGroup);

const targetMaterial = new THREE.PointsMaterial({ color: 0x4ec4dd, size: 2.1, sizeAttenuation: false });
const estimateMaterial = new THREE.PointsMaterial({ color: 0xff856c, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 1 });
const truthMaterial = new THREE.PointsMaterial({ color: 0x83d6a1, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 1 });
let targetPoints;
let estimatePoints;
let truthPoints;
let activeMode = "estimate";
let loadVersion = 0;

function updateMetrics(text) {
  const values = {
    rre: text.match(/\brre:\s*([-+\d.eE]+)/i),
    rte: text.match(/\brte:\s*([-+\d.eE]+)/i),
    ir: text.match(/\bir:\s*([-+\d.eE]+)/i),
    mask: text.match(/\bmask_precision:\s*([-+\d.eE]+)/i),
    recall: text.match(/\brecall:\s*([-+\d.eE]+)/i)
  };
  const set = (id, value) => {
    document.getElementById(id).textContent = value;
  };
  set("metric-rre", values.rre ? `${Number(values.rre[1]).toFixed(2)}\u00b0` : "--");
  set("metric-rte", values.rte ? `${Number(values.rte[1]).toFixed(3)} m` : "--");
  set("metric-ir", values.ir ? `${(Number(values.ir[1]) * 100).toFixed(1)}%` : "--");
  set("metric-mask", values.mask ? `${(Number(values.mask[1]) * 100).toFixed(1)}%` : "--");
  set("metric-recall", values.recall ? `${(Number(values.recall[1]) * 100).toFixed(1)}%` : "--");
}

function setMode(mode) {
  activeMode = mode;
  if (estimatePoints) estimatePoints.visible = mode !== "ground-truth";
  if (truthPoints) truthPoints.visible = mode !== "estimate";
  estimateMaterial.opacity = mode === "compare" ? 0.8 : 1;
  truthMaterial.opacity = mode === "compare" ? 0.8 : 1;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function clearPoints() {
  for (const object of [targetPoints, estimatePoints, truthPoints]) {
    if (!object) continue;
    pointGroup.remove(object);
    object.geometry.dispose();
  }
  targetPoints = estimatePoints = truthPoints = undefined;
}

function geometryFrom(buffer) {
  const geometry = loader.parse(buffer);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function fitCamera(geometries) {
  const bounds = new THREE.Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1);
  pointGroup.position.copy(center).multiplyScalar(-1);
  controls.target.set(0, 0, 0);
  controls.minDistance = radius * 0.15;
  controls.maxDistance = radius * 8;
  camera.near = Math.max(radius / 10000, 0.01);
  camera.far = radius * 16;
  camera.position.set(radius * 0.38, radius * 0.62, radius * 1.7);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  controls.update();
}

async function showSample(id) {
  const version = ++loadVersion;
  status.textContent = `Loading sample ${id.slice(0, 6)}...`;
  clearPoints();

  const base = `visual/${id}`;
  try {
    const [targetBuffer, estimateBuffer, truthBuffer, metricsResponse] = await Promise.all([
      fetch(`${base}/ref_points.ply`).then((response) => {
        if (!response.ok) throw new Error(`Could not load ${id}/ref_points.ply`);
        return response.arrayBuffer();
      }),
      fetch(`${base}/est_transform_src.ply`).then((response) => {
        if (!response.ok) throw new Error(`Could not load ${id}/est_transform_src.ply`);
        return response.arrayBuffer();
      }),
      fetch(`${base}/gt_transform_src.ply`).then((response) => {
        if (!response.ok) throw new Error(`Could not load ${id}/gt_transform_src.ply`);
        return response.arrayBuffer();
      }),
      fetch(`${base}/out.txt`)
    ]);
    if (version !== loadVersion) return;

    const geometries = [targetBuffer, estimateBuffer, truthBuffer].map(geometryFrom);
    [targetPoints, estimatePoints, truthPoints] = geometries.map((geometry, index) => new THREE.Points(
      geometry,
      [targetMaterial, estimateMaterial, truthMaterial][index]
    ));
    pointGroup.add(targetPoints, estimatePoints, truthPoints);
    fitCamera(geometries);
    setMode(activeMode);

    if (metricsResponse.ok) updateMetrics(await metricsResponse.text());
    else updateMetrics("");
    document.getElementById("download-estimate").href = `${base}/est_transform_src.ply`;
    document.getElementById("download-ground-truth").href = `${base}/gt_transform_src.ply`;
    status.textContent = `Sample ${id.slice(0, 6)}`;
  } catch (error) {
    if (version !== loadVersion) return;
    status.textContent = "Unable to load this point-cloud sample.";
    console.error(error);
  }
}

function resizeViewer() {
  const bounds = viewer.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resizeViewer).observe(viewer);
resizeViewer();

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
selector.addEventListener("change", () => showSample(selector.value));

const rotationToggle = document.getElementById("rotation-toggle");
rotationToggle.addEventListener("click", () => {
  controls.autoRotate = !controls.autoRotate;
  const icon = rotationToggle.querySelector("i");
  const label = rotationToggle.querySelector("span:last-child");
  icon.classList.toggle("fa-pause", controls.autoRotate);
  icon.classList.toggle("fa-play", !controls.autoRotate);
  label.textContent = controls.autoRotate ? "Pause rotation" : "Resume rotation";
  rotationToggle.title = controls.autoRotate ? "Pause automatic rotation" : "Resume automatic rotation";
  rotationToggle.setAttribute("aria-pressed", String(controls.autoRotate));
});

document.getElementById("reset-view").addEventListener("click", () => {
  if (targetPoints && estimatePoints && truthPoints) fitCamera([targetPoints.geometry, estimatePoints.geometry, truthPoints.geometry]);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

setMode(activeMode);
showSample(selector.value);
animate();
