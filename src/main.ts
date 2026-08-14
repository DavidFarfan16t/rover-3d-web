import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import RAPIER from "@dimforge/rapier3d-compat";

const MODEL_URL = "/models/rover_web_optimizado_v2.glb";
const PHYSICS_HZ = 120;
const FIXED_STEP = 1 / PHYSICS_HZ;
const MAX_FRAME_DELTA = 0.08;
const MAX_SUBSTEPS = 10;
const WHEEL_RADIUS = 0.182;
const SUSPENSION_REST = 0.23;
const START = { x: 0, y: 0.62, z: 4.2 };
const TERRAIN = { width: 28, depth: 44, centerZ: -5 };
const ARTICULATION_VISUAL_GAIN = 1.55;

const gaussian = (x: number, z: number, cx: number, cz: number, radius: number, height: number) => {
  const dx = x - cx;
  const dz = z - cz;
  return height * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
};

const terrainHeight = (x: number, z: number) => {
  const rolling =
    Math.sin(x * 0.34 + z * 0.08) * 0.19 +
    Math.cos(z * 0.25 - x * 0.05) * 0.17 +
    Math.sin((x + z) * 0.43) * 0.09;

  const formations =
    gaussian(x, z, -4.5, 0.3, 2.8, 0.82) +
    gaussian(x, z, 4.2, -2.4, 2.5, 0.70) +
    gaussian(x, z, -1.0, -9.0, 3.6, 0.95) +
    gaussian(x, z, 5.0, -14.0, 3.1, 0.78) -
    gaussian(x, z, -2.0, -2.5, 1.7, 0.42) -
    gaussian(x, z, 3.1, -7.0, 2.0, 0.48) -
    gaussian(x, z, -5.0, -13.0, 2.5, 0.55);

  // Montículos estrechos, alternados sobre cada huella. La física no cambia:
  // la amplificación visual de los balancines se aplica después al modelo GLB.
  const singleWheelBumps =
    gaussian(x, z, -0.55, 1.15, 0.52, 0.29) +
    gaussian(x, z, 0.55, -0.75, 0.50, 0.32) +
    gaussian(x, z, -0.55, -2.75, 0.51, 0.30) +
    gaussian(x, z, 0.55, -4.80, 0.52, 0.33) +
    gaussian(x, z, -0.55, -6.85, 0.49, 0.31);

  const fine =
    Math.sin(x * 1.37 + z * 0.71) * 0.028 +
    Math.sin(x * 2.21 - z * 1.14) * 0.016;

  const spawnDistance = Math.hypot(x - START.x, z - START.z);
  const terrainBlend = THREE.MathUtils.smoothstep(spawnDistance, 1.35, 3.4);
  return (rolling + formations + singleWheelBumps + fine) * terrainBlend;
};

type ControlBinding = {
  node: THREE.Object3D;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
};

type Waypoint = { id: string; label: string; x: number; z: number };
type MissionBlock =
  | { id: string; type: "drive"; distance: number }
  | { id: string; type: "turn"; angle: number }
  | { id: string; type: "waypoint"; waypointId: string };

const ui = {
  speed: document.querySelector<HTMLElement>("#speed")!,
  steering: document.querySelector<HTMLElement>("#steering")!,
  contacts: document.querySelector<HTMLElement>("#contacts")!,
  suspensionLeft: document.querySelector<HTMLElement>("#suspension-left")!,
  suspensionRight: document.querySelector<HTMLElement>("#suspension-right")!,
  barLeft: document.querySelector<HTMLElement>("#bar-left")!,
  barRight: document.querySelector<HTMLElement>("#bar-right")!,
  loading: document.querySelector<HTMLElement>("#loading")!,
  loadingStatus: document.querySelector<HTMLElement>("#loading-status")!,
  cameraButton: document.querySelector<HTMLButtonElement>("#camera-button")!,
  resetButton: document.querySelector<HTMLButtonElement>("#reset-button")!,
  missionPlanner: document.querySelector<HTMLElement>("#mission-planner")!,
  missionToggle: document.querySelector<HTMLButtonElement>("#mission-toggle")!,
  missionStatus: document.querySelector<HTMLElement>("#mission-status")!,
  missionMap: document.querySelector<HTMLCanvasElement>("#mission-map")!,
  mapCoordinates: document.querySelector<HTMLElement>("#map-coordinates")!,
  driveDistance: document.querySelector<HTMLInputElement>("#drive-distance")!,
  turnAngle: document.querySelector<HTMLInputElement>("#turn-angle")!,
  waypointSelect: document.querySelector<HTMLSelectElement>("#waypoint-select")!,
  addDriveBlock: document.querySelector<HTMLButtonElement>("#add-drive-block")!,
  addTurnBlock: document.querySelector<HTMLButtonElement>("#add-turn-block")!,
  addWaypointBlock: document.querySelector<HTMLButtonElement>("#add-waypoint-block")!,
  missionSequence: document.querySelector<HTMLOListElement>("#mission-sequence")!,
  clearMission: document.querySelector<HTMLButtonElement>("#clear-mission")!,
  missionPlay: document.querySelector<HTMLButtonElement>("#mission-play")!,
  missionPause: document.querySelector<HTMLButtonElement>("#mission-pause")!,
  missionStop: document.querySelector<HTMLButtonElement>("#mission-stop")!,
};

async function start() {
  await RAPIER.init();
  ui.loadingStatus.textContent = "Cargando rover optimizado V2…";

  const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071019);
  scene.fog = new THREE.Fog(0x071019, 18, 45);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.03, 100);
  camera.position.set(3.2, 2.15, 6.2);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.06;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.minDistance = 1.7;
  orbit.maxDistance = 12;
  orbit.target.set(0, 0.55, START.z);

  scene.add(new THREE.HemisphereLight(0x9dd5ff, 0x28130c, 1.7));
  const sun = new THREE.DirectionalLight(0xffead6, 3.8);
  sun.position.set(-6, 9, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -11;
  sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 11;
  sun.shadow.camera.bottom = -11;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4aaee8, 0.65);
  fill.position.set(5, 3, -6);
  scene.add(fill);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_STEP;

  createMarsTerrain(scene, world);

  const chassisBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(START.x, START.y, START.z)
      .setLinearDamping(0.18)
      .setAngularDamping(2.1)
      // El controlador raycast aplica fuerzas externas. Si Rapier duerme el
      // chasis mientras el GLB termina de cargar, esas fuerzas pueden no
      // arrancar el rover hasta hacer un reinicio manual.
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(12),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.43, 0.12, 0.46)
      .setTranslation(0, -0.04, 0)
      .setDensity(90)
      .setFriction(1.1)
      .setRestitution(0),
    chassisBody,
  );

  const vehicle = world.createVehicleController(chassisBody);
  vehicle.indexUpAxis = 1;
  vehicle.setIndexForwardAxis = 2;

  // Orden: delantera izquierda, delantera derecha, trasera izquierda, trasera derecha.
  const wheelConnections = [
    { x: -0.55, y: -0.03, z: -0.37 },
    { x: 0.55, y: -0.03, z: -0.37 },
    { x: -0.55, y: -0.03, z: 0.37 },
    { x: 0.55, y: -0.03, z: 0.37 },
  ];

  wheelConnections.forEach((point) => {
    vehicle.addWheel(point, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION_REST, WHEEL_RADIUS);
    const index = vehicle.numWheels() - 1;
    vehicle.setWheelSuspensionStiffness(index, 30);
    vehicle.setWheelSuspensionCompression(index, 5.8);
    vehicle.setWheelSuspensionRelaxation(index, 7.0);
    vehicle.setWheelMaxSuspensionTravel(index, 0.26);
    vehicle.setWheelMaxSuspensionForce(index, 4200);
    vehicle.setWheelFrictionSlip(index, 2.7);
    vehicle.setWheelSideFrictionStiffness(index, 0.82);
  });

  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const roverVisual = new THREE.Group();
  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  // El origen visual coincide con el cuerpo físico; la parte inferior de las
  // ruedas queda a la misma altura que el extremo de los rayos de suspensión.
  model.position.set(
    -center.x,
    -bounds.min.y - (SUSPENSION_REST + WHEEL_RADIUS),
    -center.z,
  );
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  roverVisual.add(model);
  scene.add(roverVisual);
  model.updateMatrixWorld(true);

  const bind = (name: string, desiredModelAxis: THREE.Vector3): ControlBinding | null => {
    const node = model.getObjectByName(name);
    if (!node) {
      console.warn(`No se encontró el control ${name}`);
      return null;
    }
    const parentRotation = node.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    return {
      node,
      base: node.quaternion.clone(),
      axis: desiredModelAxis.clone().applyQuaternion(parentRotation.invert()).normalize(),
    };
  };

  const wheels = ["WHEEL_FL", "WHEEL_FR", "WHEEL_RL", "WHEEL_RR"]
    .map((name) => bind(name, new THREE.Vector3(1, 0, 0)));
  const steeringControls = ["STEER_FL_CTRL", "STEER_FR_CTRL", "STEER_RL_CTRL", "STEER_RR_CTRL"]
    .map((name) => bind(name, new THREE.Vector3(0, 1, 0)));
  const suspensionControls = [bind("SUSP_L_CTRL", new THREE.Vector3(1, 0, 0)), bind("SUSP_R_CTRL", new THREE.Vector3(1, 0, 0))];
  const differential = model.getObjectByName("DIFF_CTRL");
  const differentialBase = differential?.quaternion.clone();

  const pressed = new Set<string>();
  let steering = 0;
  let leftRocker = 0;
  let rightRocker = 0;
  let followCamera = true;
  let accumulator = 0;
  const clock = new THREE.Clock();
  const tempQuaternion = new THREE.Quaternion();
  const cameraTarget = new THREE.Vector3();
  const cameraDesired = new THREE.Vector3();

  const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const defaultWaypoints: Waypoint[] = [
    { id: "wp-1", label: "WP1", x: -0.55, z: 1.15 },
    { id: "wp-2", label: "WP2", x: 0.55, z: -0.75 },
    { id: "wp-3", label: "WP3", x: -0.55, z: -2.75 },
  ];
  let waypoints: Waypoint[] = defaultWaypoints.map((point) => ({ ...point }));
  let missionBlocks: MissionBlock[] = defaultWaypoints.map((point, index) => ({
    id: `default-block-${index + 1}`,
    type: "waypoint",
    waypointId: point.id,
  }));

  try {
    const stored = localStorage.getItem("rover-mission-v1");
    if (stored) {
      const parsed = JSON.parse(stored) as { waypoints?: Waypoint[]; blocks?: MissionBlock[] };
      if (Array.isArray(parsed.waypoints) && parsed.waypoints.length) waypoints = parsed.waypoints;
      if (Array.isArray(parsed.blocks)) missionBlocks = parsed.blocks;
    }
  } catch (error) {
    console.warn("No se pudo recuperar la misión guardada", error);
  }

  const mission = {
    running: false,
    paused: false,
    index: 0,
    activeBlockId: "" as string,
    startX: START.x,
    startZ: START.z,
    startForward: new THREE.Vector3(0, 0, -1),
    targetForward: new THREE.Vector3(0, 0, -1),
  };
  const roverTrail: Array<{ x: number; z: number }> = [];
  const latestRoverMapPosition = { x: START.x, z: START.z };
  let mapPointerWorld: { x: number; z: number } | null = null;
  let missionMapElapsed = 0;
  const missionMapContext = ui.missionMap.getContext("2d")!;
  const missionMapBackground = document.createElement("canvas");
  missionMapBackground.width = 320;
  missionMapBackground.height = 210;

  const saveMission = () => {
    try {
      localStorage.setItem("rover-mission-v1", JSON.stringify({ waypoints, blocks: missionBlocks }));
    } catch (error) {
      console.warn("No se pudo guardar la misión", error);
    }
  };

  const setMissionStatus = (status: string, color = "") => {
    ui.missionStatus.textContent = status;
    ui.missionStatus.style.color = color;
  };

  const updateMissionButtons = () => {
    ui.missionPlay.textContent = mission.running && mission.paused ? "▶ REANUDAR" : "▶ PLAY";
    ui.missionPause.disabled = !mission.running || mission.paused;
    ui.missionStop.disabled = !mission.running && mission.index === 0;
  };

  const blockLabel = (block: MissionBlock) => {
    if (block.type === "drive") return `AVANZAR ${block.distance.toFixed(1)} m`;
    if (block.type === "turn") return `GIRAR ${block.angle > 0 ? "+" : ""}${Math.round(block.angle)}°`;
    const waypoint = waypoints.find((point) => point.id === block.waypointId);
    return waypoint
      ? `IR A ${waypoint.label} · X ${waypoint.x.toFixed(1)} · Z ${waypoint.z.toFixed(1)}`
      : "IR A WAYPOINT ELIMINADO";
  };

  const renderWaypointOptions = () => {
    const selected = ui.waypointSelect.value;
    ui.waypointSelect.replaceChildren();
    waypoints.forEach((waypoint) => {
      const option = document.createElement("option");
      option.value = waypoint.id;
      option.textContent = `${waypoint.label} · X ${waypoint.x.toFixed(1)} · Z ${waypoint.z.toFixed(1)}`;
      ui.waypointSelect.append(option);
    });
    if (waypoints.some((point) => point.id === selected)) ui.waypointSelect.value = selected;
  };

  const renderMissionSequence = () => {
    ui.missionSequence.replaceChildren();
    if (!missionBlocks.length) {
      const empty = document.createElement("li");
      empty.className = "mission-empty";
      empty.textContent = "Añade bloques para crear una misión.";
      ui.missionSequence.append(empty);
      return;
    }

    missionBlocks.forEach((block, index) => {
      const item = document.createElement("li");
      item.className = "mission-block";
      if (mission.running && index === mission.index) item.classList.add("active");
      if ((mission.running || mission.index > 0) && index < mission.index) item.classList.add("done");

      const number = document.createElement("span");
      number.className = "mission-block-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const label = document.createElement("span");
      label.textContent = blockLabel(block);
      const actions = document.createElement("span");
      actions.className = "mission-block-actions";

      const moveUp = document.createElement("button");
      moveUp.type = "button";
      moveUp.textContent = "↑";
      moveUp.title = "Subir bloque";
      moveUp.disabled = index === 0;
      moveUp.addEventListener("click", () => {
        stopMission(false);
        [missionBlocks[index - 1], missionBlocks[index]] = [missionBlocks[index], missionBlocks[index - 1]];
        saveMission();
        renderMissionSequence();
      });

      const moveDown = document.createElement("button");
      moveDown.type = "button";
      moveDown.textContent = "↓";
      moveDown.title = "Bajar bloque";
      moveDown.disabled = index === missionBlocks.length - 1;
      moveDown.addEventListener("click", () => {
        stopMission(false);
        [missionBlocks[index + 1], missionBlocks[index]] = [missionBlocks[index], missionBlocks[index + 1]];
        saveMission();
        renderMissionSequence();
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Eliminar bloque";
      remove.addEventListener("click", () => {
        stopMission(false);
        missionBlocks.splice(index, 1);
        saveMission();
        renderMissionSequence();
      });

      actions.append(moveUp, moveDown, remove);
      item.append(number, label, actions);
      ui.missionSequence.append(item);
    });
  };

  const buildMissionMapBackground = () => {
    const context = missionMapBackground.getContext("2d")!;
    const image = context.createImageData(missionMapBackground.width, missionMapBackground.height);
    const zMax = TERRAIN.centerZ + TERRAIN.depth / 2;
    for (let py = 0; py < missionMapBackground.height; py += 1) {
      for (let px = 0; px < missionMapBackground.width; px += 1) {
        const x = -TERRAIN.width / 2 + (px / (missionMapBackground.width - 1)) * TERRAIN.width;
        const z = zMax - (py / (missionMapBackground.height - 1)) * TERRAIN.depth;
        const height = terrainHeight(x, z);
        const shade = THREE.MathUtils.clamp(0.42 + height * 0.25, 0.18, 0.84);
        const offset = (py * missionMapBackground.width + px) * 4;
        image.data[offset] = 90 + shade * 105;
        image.data[offset + 1] = 31 + shade * 54;
        image.data[offset + 2] = 20 + shade * 30;
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  };

  const worldToMap = (x: number, z: number) => ({
    x: ((x + TERRAIN.width / 2) / TERRAIN.width) * ui.missionMap.width,
    y: ((TERRAIN.centerZ + TERRAIN.depth / 2 - z) / TERRAIN.depth) * ui.missionMap.height,
  });

  const mapEventToWorld = (event: MouseEvent) => {
    const rect = ui.missionMap.getBoundingClientRect();
    const u = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const v = THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height, 0, 1);
    return {
      x: -TERRAIN.width / 2 + u * TERRAIN.width,
      z: TERRAIN.centerZ + TERRAIN.depth / 2 - v * TERRAIN.depth,
    };
  };

  const updateMapCoordinateReadout = (point: { x: number; z: number }, source: "ROVER" | "CURSOR") => {
    if (source === "ROVER") {
      ui.mapCoordinates.textContent = `ROVER · X ${point.x.toFixed(1)} m · Z ${point.z.toFixed(1)} m`;
      return;
    }
    const distance = Math.hypot(point.x - latestRoverMapPosition.x, point.z - latestRoverMapPosition.z);
    ui.mapCoordinates.textContent = `CURSOR · X ${point.x.toFixed(1)} m · Z ${point.z.toFixed(1)} m · AL ROVER ${distance.toFixed(1)} m`;
  };

  const drawMissionMap = (position: { x: number; z: number }, rotation: { x: number; y: number; z: number; w: number }) => {
    const context = missionMapContext;
    latestRoverMapPosition.x = position.x;
    latestRoverMapPosition.z = position.z;
    if (!mapPointerWorld) updateMapCoordinateReadout(position, "ROVER");
    context.clearRect(0, 0, ui.missionMap.width, ui.missionMap.height);
    context.drawImage(missionMapBackground, 0, 0, ui.missionMap.width, ui.missionMap.height);

    const xMin = -TERRAIN.width / 2;
    const xMax = TERRAIN.width / 2;
    const zMin = TERRAIN.centerZ - TERRAIN.depth / 2;
    const zMax = TERRAIN.centerZ + TERRAIN.depth / 2;
    for (let meter = Math.ceil(xMin); meter <= Math.floor(xMax); meter += 1) {
      const x = worldToMap(meter, 0).x;
      const major = meter % 5 === 0;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, ui.missionMap.height);
      context.strokeStyle = meter === 0 ? "rgba(129, 217, 255, .62)" : major ? "rgba(245, 225, 205, .32)" : "rgba(245, 225, 205, .12)";
      context.lineWidth = meter === 0 ? 3 : major ? 2 : 1;
      context.stroke();
    }
    for (let meter = Math.ceil(zMin); meter <= Math.floor(zMax); meter += 1) {
      const y = worldToMap(0, meter).y;
      const major = meter % 5 === 0;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(ui.missionMap.width, y);
      context.strokeStyle = meter === 0 ? "rgba(129, 217, 255, .62)" : major ? "rgba(245, 225, 205, .32)" : "rgba(245, 225, 205, .12)";
      context.lineWidth = meter === 0 ? 3 : major ? 2 : 1;
      context.stroke();
    }

    context.font = "500 20px Barlow Condensed, sans-serif";
    context.fillStyle = "rgba(244, 240, 231, .82)";
    context.strokeStyle = "rgba(4, 7, 10, .92)";
    context.lineWidth = 5;
    context.textBaseline = "bottom";
    context.textAlign = "center";
    for (let meter = Math.ceil(xMin / 5) * 5; meter <= Math.floor(xMax / 5) * 5; meter += 5) {
      const x = worldToMap(meter, 0).x;
      const label = `${meter} m`;
      context.strokeText(label, x, ui.missionMap.height - 7);
      context.fillText(label, x, ui.missionMap.height - 7);
    }
    context.textBaseline = "middle";
    context.textAlign = "left";
    for (let meter = Math.ceil(zMin / 5) * 5; meter <= Math.floor(zMax / 5) * 5; meter += 5) {
      const y = worldToMap(0, meter).y;
      if (y < 16 || y > ui.missionMap.height - 26) continue;
      const label = `Z ${meter}`;
      context.strokeText(label, 8, y);
      context.fillText(label, 8, y);
    }

    const routePoints = missionBlocks
      .filter((block): block is Extract<MissionBlock, { type: "waypoint" }> => block.type === "waypoint")
      .map((block) => waypoints.find((point) => point.id === block.waypointId))
      .filter((point): point is Waypoint => Boolean(point));
    if (routePoints.length) {
      const start = worldToMap(START.x, START.z);
      const segmentLabels: Array<{ x: number; y: number; distance: number }> = [];
      let previousWorld = { x: START.x, z: START.z };
      context.beginPath();
      context.moveTo(start.x, start.y);
      routePoints.forEach((point) => {
        const mapPoint = worldToMap(point.x, point.z);
        context.lineTo(mapPoint.x, mapPoint.y);
        segmentLabels.push({
          x: (worldToMap(previousWorld.x, previousWorld.z).x + mapPoint.x) * 0.5,
          y: (worldToMap(previousWorld.x, previousWorld.z).y + mapPoint.y) * 0.5,
          distance: Math.hypot(point.x - previousWorld.x, point.z - previousWorld.z),
        });
        previousWorld = point;
      });
      context.setLineDash([9, 7]);
      context.strokeStyle = "rgba(129, 217, 255, .7)";
      context.lineWidth = 3;
      context.stroke();
      context.setLineDash([]);

      context.font = "500 20px Barlow Condensed, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      segmentLabels.forEach((segment) => {
        const label = `${segment.distance.toFixed(1)} m`;
        const width = context.measureText(label).width + 14;
        context.fillStyle = "rgba(4, 7, 10, .86)";
        context.fillRect(segment.x - width / 2, segment.y - 13, width, 26);
        context.fillStyle = "#81d9ff";
        context.fillText(label, segment.x, segment.y + 1);
      });
    }

    if (roverTrail.length > 1) {
      context.beginPath();
      roverTrail.forEach((point, index) => {
        const mapPoint = worldToMap(point.x, point.z);
        if (index === 0) context.moveTo(mapPoint.x, mapPoint.y);
        else context.lineTo(mapPoint.x, mapPoint.y);
      });
      context.strokeStyle = "rgba(101, 232, 166, .52)";
      context.lineWidth = 3;
      context.stroke();
    }

    const activeMissionBlock = missionBlocks[mission.index];
    const activeWaypointId = activeMissionBlock?.type === "waypoint" ? activeMissionBlock.waypointId : "";
    waypoints.forEach((waypoint, index) => {
      const point = worldToMap(waypoint.x, waypoint.z);
      context.beginPath();
      context.arc(point.x, point.y, 17, 0, Math.PI * 2);
      context.fillStyle = waypoint.id === activeWaypointId && mission.running ? "#65e8a6" : "#071019";
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = "#81d9ff";
      context.stroke();
      context.fillStyle = waypoint.id === activeWaypointId && mission.running ? "#071019" : "#f4f0e7";
      context.font = "600 21px Barlow Condensed, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), point.x, point.y + 1);

      const labelOnLeft = point.x > ui.missionMap.width - 185;
      const coordinateLabel = `${waypoint.label}  X ${waypoint.x.toFixed(1)} · Z ${waypoint.z.toFixed(1)}`;
      context.font = "500 18px Barlow Condensed, sans-serif";
      context.textAlign = labelOnLeft ? "right" : "left";
      context.textBaseline = "bottom";
      context.strokeStyle = "rgba(4, 7, 10, .94)";
      context.lineWidth = 5;
      context.strokeText(coordinateLabel, point.x + (labelOnLeft ? -23 : 23), point.y - 8);
      context.fillStyle = "rgba(244, 240, 231, .88)";
      context.fillText(coordinateLabel, point.x + (labelOnLeft ? -23 : 23), point.y - 8);
    });

    const roverPoint = worldToMap(position.x, position.z);
    const roverRotation = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(roverRotation);
    const mapAngle = Math.atan2(-forward.z, forward.x) + Math.PI / 2;
    context.save();
    context.translate(roverPoint.x, roverPoint.y);
    context.rotate(mapAngle);
    context.beginPath();
    context.moveTo(0, -15);
    context.lineTo(11, 12);
    context.lineTo(0, 7);
    context.lineTo(-11, 12);
    context.closePath();
    context.fillStyle = "#65e8a6";
    context.fill();
    context.strokeStyle = "#071019";
    context.lineWidth = 2;
    context.stroke();
    context.restore();

    if (mapPointerWorld) {
      const pointer = worldToMap(mapPointerWorld.x, mapPointerWorld.z);
      context.beginPath();
      context.moveTo(pointer.x - 15, pointer.y);
      context.lineTo(pointer.x + 15, pointer.y);
      context.moveTo(pointer.x, pointer.y - 15);
      context.lineTo(pointer.x, pointer.y + 15);
      context.strokeStyle = "rgba(244, 240, 231, .9)";
      context.lineWidth = 2;
      context.stroke();
    }
  };

  buildMissionMapBackground();
  renderWaypointOptions();
  renderMissionSequence();

  const getRoverForward = () => {
    const rotation = chassisBody.rotation();
    return new THREE.Vector3(0, 0, -1)
      .applyQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w))
      .setY(0)
      .normalize();
  };

  const signedHeadingError = (forward: THREE.Vector3, target: THREE.Vector3) => {
    const dot = THREE.MathUtils.clamp(forward.dot(target), -1, 1);
    const crossY = forward.z * target.x - forward.x * target.z;
    return Math.atan2(crossY, dot);
  };

  function stopMission(resetIndex = true, status = "DETENIDA") {
    mission.running = false;
    mission.paused = false;
    mission.activeBlockId = "";
    if (resetIndex) mission.index = 0;
    setMissionStatus(status, status === "COMPLETA" ? "#65e8a6" : "");
    updateMissionButtons();
    renderMissionSequence();
  }

  function pauseMission(status = "PAUSADA") {
    if (!mission.running || mission.paused) return;
    mission.paused = true;
    setMissionStatus(status, "#dfb85c");
    updateMissionButtons();
  }

  function startMission() {
    if (mission.running && mission.paused) {
      mission.paused = false;
      setMissionStatus(`BLOQUE ${mission.index + 1}/${missionBlocks.length}`, "#65e8a6");
      updateMissionButtons();
      chassisBody.wakeUp();
      return;
    }
    if (!missionBlocks.length) {
      setMissionStatus("SIN BLOQUES", "#dfb85c");
      return;
    }
    resetRover(true);
    mission.running = true;
    mission.paused = false;
    mission.index = 0;
    mission.activeBlockId = "";
    setMissionStatus(`BLOQUE 1/${missionBlocks.length}`, "#65e8a6");
    updateMissionButtons();
    renderMissionSequence();
    chassisBody.wakeUp();
  }

  const completeMissionBlock = () => {
    mission.index += 1;
    mission.activeBlockId = "";
    if (mission.index >= missionBlocks.length) {
      stopMission(false, "COMPLETA");
      return;
    }
    setMissionStatus(`BLOQUE ${mission.index + 1}/${missionBlocks.length}`, "#65e8a6");
    renderMissionSequence();
  };

  const getMissionCommand = () => {
    if (!mission.running || mission.paused) return { throttle: 0, steer: 0 };
    const block = missionBlocks[mission.index];
    if (!block) {
      stopMission(false, "COMPLETA");
      return { throttle: 0, steer: 0 };
    }

    const position = chassisBody.translation();
    const forward = getRoverForward();
    if (mission.activeBlockId !== block.id) {
      mission.activeBlockId = block.id;
      mission.startX = position.x;
      mission.startZ = position.z;
      mission.startForward.copy(forward);
      mission.targetForward.copy(forward);
      if (block.type === "turn") {
        mission.targetForward.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(block.angle));
      }
      renderMissionSequence();
    }

    if (block.type === "drive") {
      const traveled = Math.hypot(position.x - mission.startX, position.z - mission.startZ);
      const remaining = Math.max(0, block.distance - traveled);
      if (remaining <= 0.08) {
        completeMissionBlock();
        return { throttle: 0, steer: 0 };
      }
      const headingError = signedHeadingError(forward, mission.startForward);
      const steer = THREE.MathUtils.clamp(headingError / 0.42, -1, 1);
      const throttle = remaining < 0.55 ? THREE.MathUtils.lerp(0.22, 0.48, remaining / 0.55) : 0.7;
      return { throttle: Math.abs(headingError) > 0.85 ? 0.18 : throttle, steer };
    }

    if (block.type === "turn") {
      const headingError = signedHeadingError(forward, mission.targetForward);
      if (Math.abs(headingError) < THREE.MathUtils.degToRad(3.5)) {
        completeMissionBlock();
        return { throttle: 0, steer: 0 };
      }
      return {
        throttle: Math.abs(headingError) > 0.2 ? 0.28 : 0.16,
        steer: THREE.MathUtils.clamp(headingError / 0.38, -1, 1),
      };
    }

    const waypoint = waypoints.find((point) => point.id === block.waypointId);
    if (!waypoint) {
      completeMissionBlock();
      return { throttle: 0, steer: 0 };
    }
    const toTarget = new THREE.Vector3(waypoint.x - position.x, 0, waypoint.z - position.z);
    const distance = toTarget.length();
    if (distance < 0.43) {
      completeMissionBlock();
      return { throttle: 0, steer: 0 };
    }
    toTarget.normalize();
    const headingError = signedHeadingError(forward, toTarget);
    const steer = THREE.MathUtils.clamp(headingError / 0.48, -1, 1);
    const approach = THREE.MathUtils.clamp(distance / 1.6, 0.32, 0.78);
    const turnPenalty = THREE.MathUtils.clamp(1 - Math.abs(headingError) / 1.35, 0.12, 1);
    return { throttle: approach * turnPenalty, steer };
  };

  const setPressed = (code: string, value: boolean) => {
    if (value) pressed.add(code);
    else pressed.delete(code);
    if (value && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(code)) {
      chassisBody.wakeUp();
      pauseMission("CONTROL MANUAL");
    }
    document.querySelectorAll<HTMLButtonElement>(`[data-key="${code}"]`).forEach((button) => button.classList.toggle("active", value));
  };

  const toggleCamera = () => {
    followCamera = !followCamera;
    orbit.enabled = !followCamera;
    ui.cameraButton.textContent = `CÁMARA: ${followCamera ? "SEGUIMIENTO" : "ÓRBITA LIBRE"}`;
  };

  const resetRover = (preserveMission = false) => {
    ["KeyW", "KeyA", "KeyS", "KeyD"].forEach((code) => setPressed(code, false));
    accumulator = 0;
    chassisBody.setTranslation(START, true);
    chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    steering = 0;
    leftRocker = 0;
    rightRocker = 0;
    roverTrail.length = 0;
    if (!preserveMission) stopMission(true, "LISTA");
    for (let index = 0; index < 4; index += 1) {
      vehicle.setWheelEngineForce(index, 0);
      vehicle.setWheelBrake(index, 0);
      vehicle.setWheelSteering(index, 0);
    }
    chassisBody.wakeUp();
  };

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      event.preventDefault();
      setPressed(event.code, true);
    }
    if (event.code === "KeyR" && !event.repeat) resetRover();
    if (event.code === "KeyC" && !event.repeat) toggleCamera();
  });
  window.addEventListener("keyup", (event) => setPressed(event.code, false));
  window.addEventListener("blur", () => ["KeyW", "KeyA", "KeyS", "KeyD"].forEach((code) => setPressed(code, false)));
  document.addEventListener("visibilitychange", () => {
    // Evita acumular un salto de tiempo al volver a la pestaña.
    clock.getDelta();
    if (!document.hidden) chassisBody.wakeUp();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach((button) => {
    const code = button.dataset.key!;
    const release = () => setPressed(code, false);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      setPressed(code, true);
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
  });
  ui.cameraButton.addEventListener("click", toggleCamera);
  ui.resetButton.addEventListener("click", () => resetRover());

  const redrawCurrentMap = () => drawMissionMap(chassisBody.translation(), chassisBody.rotation());
  const appendBlock = (block: MissionBlock) => {
    stopMission(true, "LISTA");
    missionBlocks.push(block);
    saveMission();
    renderMissionSequence();
    redrawCurrentMap();
  };

  ui.missionToggle.addEventListener("click", () => {
    const collapsed = ui.missionPlanner.classList.toggle("collapsed");
    ui.missionToggle.textContent = collapsed ? "+" : "−";
    ui.missionToggle.setAttribute("aria-expanded", String(!collapsed));
    ui.missionToggle.setAttribute("aria-label", collapsed ? "Mostrar planificador" : "Ocultar planificador");
  });
  ui.addDriveBlock.addEventListener("click", () => {
    const distance = THREE.MathUtils.clamp(Number(ui.driveDistance.value) || 0, 0.2, 30);
    ui.driveDistance.value = distance.toFixed(1);
    appendBlock({ id: makeId("drive"), type: "drive", distance });
  });
  ui.addTurnBlock.addEventListener("click", () => {
    const angle = THREE.MathUtils.clamp(Number(ui.turnAngle.value) || 0, -180, 180);
    ui.turnAngle.value = String(Math.round(angle));
    appendBlock({ id: makeId("turn"), type: "turn", angle });
  });
  ui.addWaypointBlock.addEventListener("click", () => {
    if (!ui.waypointSelect.value) return;
    appendBlock({ id: makeId("goto"), type: "waypoint", waypointId: ui.waypointSelect.value });
  });
  ui.clearMission.addEventListener("click", () => {
    stopMission(true, "LISTA");
    missionBlocks = [];
    saveMission();
    renderMissionSequence();
    redrawCurrentMap();
  });
  ui.missionPlay.addEventListener("click", startMission);
  ui.missionPause.addEventListener("click", () => pauseMission());
  ui.missionStop.addEventListener("click", () => stopMission(true, "DETENIDA"));
  ui.missionMap.addEventListener("mousemove", (event) => {
    mapPointerWorld = mapEventToWorld(event);
    updateMapCoordinateReadout(mapPointerWorld, "CURSOR");
    redrawCurrentMap();
  });
  ui.missionMap.addEventListener("mouseleave", () => {
    mapPointerWorld = null;
    updateMapCoordinateReadout(latestRoverMapPosition, "ROVER");
    redrawCurrentMap();
  });
  ui.missionMap.addEventListener("click", (event) => {
    const coordinate = mapEventToWorld(event);
    const waypoint: Waypoint = {
      id: makeId("wp"),
      label: `WP${waypoints.length + 1}`,
      x: Math.round(coordinate.x * 10) / 10,
      z: Math.round(coordinate.z * 10) / 10,
    };
    waypoints.push(waypoint);
    saveMission();
    renderWaypointOptions();
    ui.waypointSelect.value = waypoint.id;
    redrawCurrentMap();
  });
  ui.missionMap.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const { x, z } = mapEventToWorld(event);
    let nearestIndex = -1;
    let nearestDistance = 1.15;
    waypoints.forEach((point, index) => {
      const distance = Math.hypot(point.x - x, point.z - z);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    if (nearestIndex < 0) return;
    stopMission(true, "LISTA");
    const [removed] = waypoints.splice(nearestIndex, 1);
    missionBlocks = missionBlocks.filter((block) => block.type !== "waypoint" || block.waypointId !== removed.id);
    waypoints.forEach((point, index) => { point.label = `WP${index + 1}`; });
    saveMission();
    renderWaypointOptions();
    renderMissionSequence();
    redrawCurrentMap();
  });

  const applyBinding = (binding: ControlBinding | null, angle: number) => {
    if (!binding) return;
    tempQuaternion.setFromAxisAngle(binding.axis, angle);
    binding.node.quaternion.copy(binding.base).premultiply(tempQuaternion);
  };

  const updateVehicle = (dt: number) => {
    const manualThrottle = Number(pressed.has("KeyW")) - Number(pressed.has("KeyS"));
    const manualSteer = Number(pressed.has("KeyA")) - Number(pressed.has("KeyD"));
    const autonomous = getMissionCommand();
    const autopilotActive = mission.running && !mission.paused;
    const throttle = autopilotActive ? autonomous.throttle : manualThrottle;
    const steerInput = autopilotActive ? autonomous.steer : manualSteer;
    const speedNow = Math.abs(vehicle.currentVehicleSpeed());
    const speedRatio = THREE.MathUtils.clamp(speedNow / 1.7, 0, 1);
    const steeringLimit = THREE.MathUtils.lerp(0.47, 0.31, speedRatio);
    steering = THREE.MathUtils.damp(steering, steerInput * steeringLimit, 7, dt);
    const engineForce = speedNow < 1.7 ? throttle * -38 : 0;
    const brake = Math.abs(throttle) < 0.01 ? (autopilotActive ? 3.4 : 1.5) : 0;

    if (throttle !== 0 || steerInput !== 0) chassisBody.wakeUp();

    for (let index = 0; index < 4; index += 1) {
      vehicle.setWheelEngineForce(index, engineForce);
      vehicle.setWheelBrake(index, brake);
      vehicle.setWheelSteering(index, index < 2 ? steering : -steering * 0.68);
    }
    vehicle.updateVehicle(dt);
    world.step();
  };

  const updateVisuals = (dt: number) => {
    const position = chassisBody.translation();
    const rotation = chassisBody.rotation();
    roverVisual.position.set(position.x, position.y, position.z);
    roverVisual.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    steeringControls.forEach((control, index) => applyBinding(control, index < 2 ? steering : -steering * 0.68));
    wheels.forEach((wheel, index) => applyBinding(wheel, vehicle.wheelRotation(index) ?? 0));

    const lengths = [0, 1, 2, 3].map((index) => vehicle.wheelSuspensionLength(index) ?? SUSPENSION_REST);
    const sideWheelbase = Math.abs(wheelConnections[2].z - wheelConnections[0].z);
    const leftTarget = THREE.MathUtils.clamp(
      Math.atan2(lengths[2] - lengths[0], sideWheelbase) * ARTICULATION_VISUAL_GAIN,
      -0.52,
      0.52,
    );
    const rightTarget = THREE.MathUtils.clamp(
      Math.atan2(lengths[1] - lengths[3], sideWheelbase) * ARTICULATION_VISUAL_GAIN,
      -0.52,
      0.52,
    );
    leftRocker = THREE.MathUtils.damp(leftRocker, leftTarget, 12, dt);
    rightRocker = THREE.MathUtils.damp(rightRocker, rightTarget, 12, dt);
    applyBinding(suspensionControls[0], leftRocker);
    applyBinding(suspensionControls[1], rightRocker);
    if (differential && differentialBase) {
      tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (leftRocker - rightRocker) * 0.52);
      differential.quaternion.copy(differentialBase).premultiply(tempQuaternion);
    }

    const speed = Math.abs(vehicle.currentVehicleSpeed()) * 3.6;
    const contacts = [0, 1, 2, 3].filter((index) => vehicle.wheelIsInContact(index)).length;
    const leftCompression = Math.max(0, (SUSPENSION_REST - (lengths[0] + lengths[2]) * 0.5) * 1000);
    const rightCompression = Math.max(0, (SUSPENSION_REST - (lengths[1] + lengths[3]) * 0.5) * 1000);
    ui.speed.textContent = speed.toFixed(1);
    ui.steering.textContent = `${Math.round(THREE.MathUtils.radToDeg(steering))}°`;
    ui.contacts.textContent = `${contacts}/4`;
    ui.suspensionLeft.textContent = `${Math.round(leftCompression)} mm`;
    ui.suspensionRight.textContent = `${Math.round(rightCompression)} mm`;
    ui.barLeft.style.width = `${THREE.MathUtils.clamp(leftCompression / 1.4, 4, 100)}%`;
    ui.barRight.style.width = `${THREE.MathUtils.clamp(rightCompression / 1.4, 4, 100)}%`;

    const lastTrailPoint = roverTrail.at(-1);
    if (!lastTrailPoint || Math.hypot(position.x - lastTrailPoint.x, position.z - lastTrailPoint.z) > 0.18) {
      roverTrail.push({ x: position.x, z: position.z });
      if (roverTrail.length > 480) roverTrail.shift();
    }
    missionMapElapsed += dt;
    if (missionMapElapsed >= 0.1) {
      missionMapElapsed = 0;
      drawMissionMap(position, rotation);
    }

    if (followCamera) {
      orbit.enabled = false;
      cameraTarget.set(position.x, position.y + 0.32, position.z);
      cameraDesired.set(2.5, 1.7, 4.0).applyQuaternion(roverVisual.quaternion).add(cameraTarget);
      const amount = 1 - Math.exp(-dt * 3.2);
      camera.position.lerp(cameraDesired, amount);
      camera.lookAt(cameraTarget);
    } else {
      orbit.target.lerp(new THREE.Vector3(position.x, position.y + 0.25, position.z), 1 - Math.exp(-dt * 5));
      orbit.update();
    }
  };

  resetRover();
  ui.loading.classList.add("hidden");
  console.info("[rover] simulación lista", {
    physicsHz: PHYSICS_HZ,
    model: MODEL_URL,
    sleepingDisabled: true,
    ccdEnabled: true,
  });

  const animate = () => {
    const delta = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
    accumulator += delta;
    let substeps = 0;
    while (accumulator >= FIXED_STEP && substeps < MAX_SUBSTEPS) {
      updateVehicle(FIXED_STEP);
      accumulator -= FIXED_STEP;
      substeps += 1;
    }
    // Si el navegador se bloqueó durante varios cuadros, se descarta el
    // excedente para que Rapier no intente recuperar todo en un solo frame.
    if (substeps === MAX_SUBSTEPS) accumulator = 0;
    updateVisuals(delta);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  animate();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  });
}

function createMarsTerrain(scene: THREE.Scene, world: RAPIER.World) {
  const { width, depth, centerZ } = TERRAIN;
  const xSegments = 84;
  const zSegments = 132;
  const rowSize = xSegments + 1;
  const vertexCount = rowSize * (zSegments + 1);
  const vertices = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(xSegments * zSegments * 6);

  let vertexOffset = 0;
  const darkSand = new THREE.Color(0x6f2417);
  const lightSand = new THREE.Color(0xc15b2d);
  const vertexColor = new THREE.Color();

  for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
    const z = centerZ - depth / 2 + (zIndex / zSegments) * depth;
    for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
      const x = -width / 2 + (xIndex / xSegments) * width;
      const y = terrainHeight(x, z);
      vertices[vertexOffset] = x;
      vertices[vertexOffset + 1] = y;
      vertices[vertexOffset + 2] = z;

      const shade = THREE.MathUtils.clamp(0.43 + y * 0.26 + Math.sin(x * 0.7 + z * 0.4) * 0.055, 0, 1);
      vertexColor.lerpColors(darkSand, lightSand, shade);
      colors[vertexOffset] = vertexColor.r;
      colors[vertexOffset + 1] = vertexColor.g;
      colors[vertexOffset + 2] = vertexColor.b;
      vertexOffset += 3;
    }
  }

  let indexOffset = 0;
  for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
    for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
      const a = zIndex * rowSize + xIndex;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      // Orden antihorario visto desde arriba para obtener normales hacia +Y.
      indices[indexOffset] = a;
      indices[indexOffset + 1] = c;
      indices[indexOffset + 2] = b;
      indices[indexOffset + 3] = b;
      indices[indexOffset + 4] = c;
      indices[indexOffset + 5] = d;
      indexOffset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
      metalness: 0,
    }),
  );
  terrain.receiveShadow = true;
  scene.add(terrain);

  // El collider usa exactamente los mismos triángulos de la malla visible.
  const terrainBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(1.22)
      .setRestitution(0),
    terrainBody,
  );
}

start().catch((error: unknown) => {
  console.error(error);
  ui.loadingStatus.textContent = "No se pudo iniciar. Revisa la consola del navegador.";
});
