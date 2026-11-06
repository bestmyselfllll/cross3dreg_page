import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

const viewer = document.getElementById("registration-viewer");
const canvas = document.getElementById("registration-canvas");
const status = document.getElementById("viewer-status");
const selector = document.getElementById("sample-select");
const sampleImage = document.getElementById("sample-image");
const legend = document.getElementById("viewer-legend");
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
const rawSourceMaterial = new THREE.PointsMaterial({ color: 0xff856c, size: 2.2, sizeAttenuation: false });
const refSuperMaterial = new THREE.PointsMaterial({ color: 0xfbbf24, size: 5, sizeAttenuation: false });
const predSuperMaterial = new THREE.PointsMaterial({ color: 0xc084fc, size: 6, sizeAttenuation: false });
const trueCorMaterial = new THREE.LineBasicMaterial({ color: 0x83d6a1, transparent: true, opacity: 0.35, depthWrite: false });
const falseCorMaterial = new THREE.LineBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.55, depthWrite: false });

const LEGENDS = {
  estimate: [
    ["point", "#4ec4dd", "Target"],
    ["point", "#ff856c", "Estimated source"]
  ],
  "ground-truth": [
    ["point", "#4ec4dd", "Target"],
    ["point", "#83d6a1", "Ground-truth source"]
  ],
  compare: [
    ["point", "#4ec4dd", "Target"],
    ["point", "#ff856c", "Estimated source"],
    ["point", "#83d6a1", "Ground-truth source"]
  ],
  raw: [
    ["point", "#4ec4dd", "Target"],
    ["point", "#ff856c", "Untransformed source"]
  ],
  correspondences: [
    ["point", "#4ec4dd", "Target"],
    ["point", "#ff856c", "Untransformed source"],
    ["line", "#83d6a1", "True correspondences"],
    ["line", "#f87171", "False correspondences"]
  ],
  superpoints: [
    ["point", "#4ec4dd", "Target"],
    ["point", "#fbbf24", "Target superpoints"],
    ["point", "#c084fc", "Overlap superpoints"]
  ]
};

let targetPoints;
let estimatePoints;
let truthPoints;
let rawSourcePoints;
let trueCorLines;
let falseCorLines;
let refSuperPoints;
let predSuperPoints;
let activeMode = "estimate";
let loadVersion = 0;
let lastFitGroup = null;

function updateMetrics(text) {
  const values = {
    rre: text.match(/\brre:\s*([-+\d.eE]+)/i),
    rte: text.match(/\brte:\s*([-+\d.eE]+)/i),
    ir: text.match(/\bir:\s*([-+\d.eE]+)/i),
    mask: text.match(/\bmask_precision:\s*([-+\d.eE]+)/i),
    recall: text.match(/\brecall:\s*([-+\d.eE]+)/i)
  };
  // Not every metric column is rendered on the page, so skip missing nodes.
  const set = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  set("metric-rre", values.rre ? `${Number(values.rre[1]).toFixed(2)}°` : "--");
  set("metric-rte", values.rte ? `${Number(values.rte[1]).toFixed(3)} m` : "--");
  set("metric-ir", values.ir ? `${(Number(values.ir[1]) * 100).toFixed(1)}%` : "--");
  set("metric-mask", values.mask ? `${(Number(values.mask[1]) * 100).toFixed(1)}%` : "--");
  set("metric-recall", values.recall ? `${(Number(values.recall[1]) * 100).toFixed(1)}%` : "--");
}

function setVisible(object, visible) {
  if (object) object.visible = visible;
}

function updateLegend(mode) {
  legend.replaceChildren();
  for (const [kind, color, label] of LEGENDS[mode] || []) {
    const tag = document.createElement("span");
    tag.className = "tag is-light m-1";
    const swatch = document.createElement("span");
    swatch.setAttribute("aria-hidden", "true");
    swatch.style.cssText = kind === "line"
      ? `display:inline-block;width:1em;height:3px;border-radius:2px;background:${color};margin-right:.45em`
      : `display:inline-block;width:.8em;height:.8em;border-radius:50%;background:${color};margin-right:.45em`;
    tag.append(swatch, label);
    legend.append(tag);
  }
}

function modeGeometries(mode) {
  const geometry = (object) => (object ? object.geometry : null);
  const geometries = [geometry(targetPoints)];
  if (mode === "estimate" || mode === "compare") geometries.push(geometry(estimatePoints));
  if (mode === "ground-truth" || mode === "compare") geometries.push(geometry(truthPoints));
  if (mode === "raw" || mode === "correspondences") {
    geometries.push(geometry(rawSourcePoints), geometry(trueCorLines), geometry(falseCorLines));
  }
  if (mode === "superpoints") geometries.push(geometry(refSuperPoints), geometry(predSuperPoints));
  return geometries.filter(Boolean);
}

function maybeFitForMode(mode) {
  if (!targetPoints) return;
  const group = mode === "raw" || mode === "correspondences" ? "raw" : "ref";
  if (group === lastFitGroup) return;
  lastFitGroup = group;
  fitCamera(modeGeometries(mode));
}

function setMode(mode) {
  activeMode = mode;
  setVisible(targetPoints, true);
  setVisible(estimatePoints, mode === "estimate" || mode === "compare");
  setVisible(truthPoints, mode === "ground-truth" || mode === "compare");
  setVisible(rawSourcePoints, mode === "raw" || mode === "correspondences");
  setVisible(trueCorLines, mode === "correspondences");
  setVisible(falseCorLines, mode === "correspondences");
  setVisible(refSuperPoints, mode === "superpoints");
  setVisible(predSuperPoints, mode === "superpoints");
  estimateMaterial.opacity = mode === "compare" ? 0.8 : 1;
  truthMaterial.opacity = mode === "compare" ? 0.8 : 1;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updateLegend(mode);
  maybeFitForMode(mode);
}

function clearPoints() {
  for (const object of [...pointGroup.children]) {
    pointGroup.remove(object);
    object.geometry.dispose();
  }
  targetPoints = estimatePoints = truthPoints = rawSourcePoints = undefined;
  trueCorLines = falseCorLines = refSuperPoints = predSuperPoints = undefined;
}

function geometryFrom(buffer) {
  const geometry = loader.parse(buffer);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

const PLY_TYPE_READERS = {
  char: [1, (view, offset) => view.getInt8(offset)],
  int8: [1, (view, offset) => view.getInt8(offset)],
  uchar: [1, (view, offset) => view.getUint8(offset)],
  uint8: [1, (view, offset) => view.getUint8(offset)],
  short: [2, (view, offset) => view.getInt16(offset, true)],
  int16: [2, (view, offset) => view.getInt16(offset, true)],
  ushort: [2, (view, offset) => view.getUint16(offset, true)],
  uint16: [2, (view, offset) => view.getUint16(offset, true)],
  int: [4, (view, offset) => view.getInt32(offset, true)],
  int32: [4, (view, offset) => view.getInt32(offset, true)],
  uint: [4, (view, offset) => view.getUint32(offset, true)],
  uint32: [4, (view, offset) => view.getUint32(offset, true)],
  float: [4, (view, offset) => view.getFloat32(offset, true)],
  float32: [4, (view, offset) => view.getFloat32(offset, true)],
  double: [8, (view, offset) => view.getFloat64(offset, true)],
  float64: [8, (view, offset) => view.getFloat64(offset, true)]
};

// three.js PLYLoader ignores "element edge", so correspondence files need a
// small dedicated parser to recover their vertices and edge indices.
function parseEdgePly(buffer) {
  const bytes = new Uint8Array(buffer);
  const headerText = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const endMatch = /end_header\r?\n/.exec(headerText);
  if (!endMatch) throw new Error("Invalid PLY header");
  const headerEnd = endMatch.index + endMatch[0].length;
  const lines = headerText.slice(0, endMatch.index).split(/\r?\n/);

  const formatLine = lines.find((line) => line.startsWith("format "));
  if (!formatLine || !formatLine.includes("binary_little_endian")) {
    throw new Error("Only binary little-endian PLY files are supported");
  }

  const elements = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "element") {
      elements.push({ name: parts[1], count: Number(parts[2]), properties: [] });
    } else if (parts[0] === "property" && elements.length > 0) {
      if (parts[1] === "list") throw new Error("PLY list properties are not supported");
      elements[elements.length - 1].properties.push({ name: parts[2], type: parts[1] });
    }
  }

  const view = new DataView(buffer);
  let offset = headerEnd;
  let positions = null;
  const indices = [];

  for (const element of elements) {
    let stride = 0;
    const propertyMap = new Map();
    for (const property of element.properties) {
      const reader = PLY_TYPE_READERS[property.type];
      if (!reader) throw new Error(`Unknown PLY type: ${property.type}`);
      property.offset = stride;
      stride += reader[0];
      propertyMap.set(property.name, property);
    }
    if (element.name === "vertex") positions = new Float32Array(element.count * 3);

    const read = (record, name) => {
      const property = propertyMap.get(name);
      return PLY_TYPE_READERS[property.type][1](view, record + property.offset);
    };

    for (let i = 0; i < element.count; i += 1) {
      const record = offset + i * stride;
      if (element.name === "vertex") {
        positions[i * 3] = read(record, "x");
        positions[i * 3 + 1] = read(record, "y");
        positions[i * 3 + 2] = read(record, "z");
      } else if (element.name === "edge") {
        indices.push(read(record, "vertex1"), read(record, "vertex2"));
      }
    }
    offset += element.count * stride;
  }

  return { positions, index: Uint32Array.from(indices) };
}

function edgeGeometryFrom(buffer) {
  const { positions, index } = parseEdgePly(buffer);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function fitCamera(geometries) {
  if (!geometries.length) return;
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

function fetchBuffer(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.arrayBuffer();
  });
}

function fetchOptionalBuffer(url) {
  return fetch(url)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .catch(() => null);
}

// Samples normally ship the RGB preview as visual/<sample>/img.jpg, but some
// exports name it after the sample (for example visual/000241_000241/000241.jpg).
// An explicit data-image attribute on the <option> wins; otherwise try both
// conventions in order and hide the inset when neither exists.
let imageCandidates = [];
let imageCandidateIndex = 0;

sampleImage.addEventListener("load", () => {
  sampleImage.dataset.loaded = "true";
});

sampleImage.addEventListener("error", () => {
  imageCandidateIndex += 1;
  if (imageCandidateIndex < imageCandidates.length) {
    sampleImage.src = imageCandidates[imageCandidateIndex];
  } else {
    sampleImage.removeAttribute("src");
    delete sampleImage.dataset.loaded;
    sampleImage.dataset.missing = "true";
  }
});

function setSampleImage(base, id, option, label) {
  const preferred = option && option.dataset.image ? `${base}/${option.dataset.image}` : null;
  imageCandidates = [preferred, `${base}/img.jpg`, `${base}/${id.slice(0, 6)}.jpg`].filter(Boolean);
  imageCandidateIndex = 0;
  delete sampleImage.dataset.loaded;
  delete sampleImage.dataset.missing;
  sampleImage.alt = `RGB camera image for ${label}`;
  sampleImage.src = imageCandidates[0];
}

async function showSample(id) {
  const version = ++loadVersion;
  const option = selector.selectedOptions[0];
  // Label shown in the dropdown ("Sample N"); fall back to the option position.
  const label = option && option.textContent.trim()
    ? option.textContent.trim()
    : `Sample ${selector.selectedIndex + 1}`;
  status.textContent = `Loading ${label}...`;
  clearPoints();

  const base = `visual/${id}`;
  setSampleImage(base, id, option, label);

  try {
    const [
      targetBuffer,
      estimateBuffer,
      truthBuffer,
      metricsResponse,
      srcBuffer,
      trueCorBuffer,
      falseCorBuffer,
      refCBuffer,
      predCBuffer
    ] = await Promise.all([
      fetchBuffer(`${base}/ref_points.ply`),
      fetchBuffer(`${base}/est_transform_src.ply`),
      fetchBuffer(`${base}/gt_transform_src.ply`),
      fetch(`${base}/out.txt`),
      fetchOptionalBuffer(`${base}/src_points.ply`),
      fetchOptionalBuffer(`${base}/point_cor_true.ply`),
      fetchOptionalBuffer(`${base}/point_cor_false.ply`),
      fetchOptionalBuffer(`${base}/ref_points_c.ply`),
      fetchOptionalBuffer(`${base}/pred_ref_filt_points_c.ply`)
    ]);
    if (version !== loadVersion) return;

    const geometries = [targetBuffer, estimateBuffer, truthBuffer].map(geometryFrom);
    [targetPoints, estimatePoints, truthPoints] = geometries.map((geometry, index) => new THREE.Points(
      geometry,
      [targetMaterial, estimateMaterial, truthMaterial][index]
    ));
    pointGroup.add(targetPoints, estimatePoints, truthPoints);

    if (srcBuffer) {
      rawSourcePoints = new THREE.Points(geometryFrom(srcBuffer), rawSourceMaterial);
      pointGroup.add(rawSourcePoints);
    }
    if (trueCorBuffer) {
      trueCorLines = new THREE.LineSegments(edgeGeometryFrom(trueCorBuffer), trueCorMaterial);
      pointGroup.add(trueCorLines);
    }
    if (falseCorBuffer) {
      falseCorLines = new THREE.LineSegments(edgeGeometryFrom(falseCorBuffer), falseCorMaterial);
      pointGroup.add(falseCorLines);
    }
    if (refCBuffer) {
      refSuperPoints = new THREE.Points(geometryFrom(refCBuffer), refSuperMaterial);
      pointGroup.add(refSuperPoints);
    }
    if (predCBuffer) {
      predSuperPoints = new THREE.Points(geometryFrom(predCBuffer), predSuperMaterial);
      pointGroup.add(predSuperPoints);
    }

    lastFitGroup = null;
    setMode(activeMode);

    if (metricsResponse.ok) updateMetrics(await metricsResponse.text());
    else updateMetrics("");
    const estimateLink = document.getElementById("download-estimate");
    if (estimateLink) estimateLink.href = `${base}/est_transform_src.ply`;
    const truthLink = document.getElementById("download-ground-truth");
    if (truthLink) truthLink.href = `${base}/gt_transform_src.ply`;
    status.textContent = label;
  } catch (error) {
    if (version !== loadVersion) return;
    status.textContent = `Unable to load ${label}.`;
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
  lastFitGroup = null;
  maybeFitForMode(activeMode);
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

setMode(activeMode);
showSample(selector.value);
animate();
