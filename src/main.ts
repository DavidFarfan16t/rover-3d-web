import "./style.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import RAPIER from "@dimforge/rapier3d-compat";

const MODEL_URL = `${import.meta.env.BASE_URL}models/rover_web_optimizado_v3.glb`;
const PHYSICS_HZ = 120;
const FIXED_STEP = 1 / PHYSICS_HZ;
const MAX_FRAME_DELTA = 0.08;
const MAX_SUBSTEPS = 10;
const WHEEL_RADIUS = 0.182;
const SUSPENSION_REST = 0.23;
const START = { x: 0, y: 0.62, z: 4.2 };
const TERRAIN = { width: 28, depth: 44, centerZ: -5 };
const MAX_INDEPENDENT_ROCKER_ANGLE = 0.52;
const MAX_DIFFERENTIAL_ANGLE = 0.35;
const MAX_VISUAL_ROLL = 0.40;
const MAX_DRIVE_SPEED = 2.5;
// Tren motriz: cuatro motores de 2,6 N·m, cada uno con reducción 50:1.
// Rapier recibe fuerza longitudinal por rueda, por eso convertimos el par
// disponible mediante F = torque / radio. El valor ideal se limita después
// por el agarre, porque aplicar los 586 N teóricos por rueda haría patinar o
// volcar un rover de aproximadamente 45,6 kg.
const MOTOR_COUNT = 4;
const MOTOR_TORQUE_NM = 2.6;
const GEAR_RATIO = 50;
const DRIVETRAIN_EFFICIENCY = 0.82;
const ROVER_MASS_KG = 45.6;
const TIRE_TRACTION_COEFFICIENT = 1.1;
const WHEEL_TORQUE_NM = MOTOR_TORQUE_NM * GEAR_RATIO * DRIVETRAIN_EFFICIENCY;
const THEORETICAL_WHEEL_FORCE_N = WHEEL_TORQUE_NM / WHEEL_RADIUS;
const TRACTION_LIMIT_PER_WHEEL_N = ROVER_MASS_KG * 9.81 * TIRE_TRACTION_COEFFICIENT / MOTOR_COUNT;
const CRUISE_ENGINE_FORCE = 78;
const CLIMB_ENGINE_FORCE = Math.min(THEORETICAL_WHEEL_FORCE_N, TRACTION_LIMIT_PER_WHEEL_N);
const AUTOPILOT_MAX_THROTTLE = 0.88;
const THROTTLE_RISE_RATE = 1.8;
const THROTTLE_FALL_RATE = 2.2;
const TRACTION_ASSIST_RISE_RATE = 2.5;
const TRACTION_ASSIST_FALL_RATE = 2.5;
const ANTI_WHEELIE_RISE_RATE = 7.0;
const ANTI_WHEELIE_FALL_RATE = 2.2;
const ANTI_WHEELIE_MIN_TORQUE_SCALE = 0.18;
const CONTACT_RECOVERY_FORCE_PER_WHEEL = 36;
const AUTOPILOT_BRAKE = 0.9;
const MANUAL_BRAKE = 0.65;

// Apariencia del cielo marciano. Puedes cambiar estos colores CSS si quieres
// una atmósfera más clara, rojiza u oscura.
const MARS_SKY_COLORS = {
  zenith: "#754052",
  horizon: "#e49a6d",
  ground: "#74311f",
  sun: "#ffd2a6",
};

type RoverComponentName = "chassis" | "suspension" | "steering" | "motors" | "wheels";

// Coloca un color CSS en el componente que quieras modificar. Ejemplos:
// chassis: "#e86f2d"  |  wheels: "#171717"
// Con null se conserva el color/material original exportado desde Blender.
const ROVER_COMPONENT_COLORS: Record<RoverComponentName, string | null> = {
  chassis: null,
  suspension: null,
  steering: "#d21f26",
  motors: null,
  wheels: null,
};

const ROVER_COMPONENT_MATCHERS: Array<[RoverComponentName, RegExp]> = [
  ["wheels", /WHEEL_(FL|FR|RL|RR)|RUEDA 2/],
  ["motors", /3D-AK80|MOTOR AK/],
  ["steering", /STEER_/],
  ["suspension", /SUSP_|ARTICULACION|DIFERENCIAAL|LINK_|FIXED_/],
  ["chassis", /CHASIS/],
];

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

  // Montículos estrechos, alternados sobre cada huella. Cada lateral del rig
  // visual resuelve después su propio ángulo de balancín.
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

type BallLinkBinding = {
  node: THREE.Object3D;
  target: THREE.Object3D;
  base: THREE.Quaternion;
  baseScale: THREE.Vector3;
  restDirection: THREE.Vector3;
  restLength: number;
};

type Waypoint = { id: string; label: string; x: number; z: number };
type MissionBlock =
  | { id: string; type: "drive"; distance: number }
  | { id: string; type: "turn"; angle: number }
  | { id: string; type: "waypoint"; waypointId: string };
type DriveCommand = { throttle: number; steer: number; brake: number };

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
  scene.background = new THREE.Color(MARS_SKY_COLORS.horizon);
  scene.fog = new THREE.Fog(new THREE.Color(MARS_SKY_COLORS.horizon), 14, 55);
  const marsSky = createMarsSky(scene);
  createMarsHorizonGround(scene);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.03, 100);
  camera.position.set(3.2, 2.15, 6.2);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enabled = true;
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.06;
  orbit.enablePan = false;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.minDistance = 1.7;
  orbit.maxDistance = 12;
  orbit.target.set(0, 0.55, START.z);

  scene.add(new THREE.HemisphereLight(0xffcfaa, 0x28100a, 1.6));
  const sun = new THREE.DirectionalLight(0xffd8b8, 3.8);
  sun.position.set(-6, 9, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -11;
  sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 11;
  sun.shadow.camera.bottom = -11;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6c91ab, 0.48);
  fill.position.set(5, 3, -6);
  scene.add(fill);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_STEP;

  createMarsTerrain(scene, world, renderer);

  const chassisBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(START.x, START.y, START.z)
      .setLinearDamping(0.18)
      .setAngularDamping(2.85)
      // El controlador raycast aplica fuerzas externas. Si Rapier duerme el
      // chasis mientras el GLB termina de cargar, esas fuerzas pueden no
      // arrancar el rover hasta hacer un reinicio manual.
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(12),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.43, 0.12, 0.46)
      // Aproxima los 50 kg del rover real y baja ligeramente el centro de
      // masa para reducir caballitos sin impedir que copie el terreno.
      .setTranslation(0, -0.05, 0)
      .setDensity(240)
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
    vehicle.setWheelFrictionSlip(index, 3.4);
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
  applyRoverComponentColors(model);
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

  const bindBallLink = (controlName: string, targetName: string): BallLinkBinding | null => {
    const node = model.getObjectByName(controlName);
    const target = model.getObjectByName(targetName);
    if (!node || !target || !node.parent) {
      console.warn(`No se pudo enlazar la rótula visual ${controlName} -> ${targetName}`);
      return null;
    }

    const startWorld = node.getWorldPosition(new THREE.Vector3());
    const targetWorld = target.getWorldPosition(new THREE.Vector3());
    const startInParent = node.parent.worldToLocal(startWorld.clone());
    const targetInParent = node.parent.worldToLocal(targetWorld.clone());
    const restDirection = targetInParent.sub(startInParent);
    const restLength = restDirection.length();
    if (restLength < 0.000001) return null;

    return {
      node,
      target,
      base: node.quaternion.clone(),
      baseScale: node.scale.clone(),
      restDirection: restDirection.multiplyScalar(1 / restLength),
      restLength,
    };
  };

  const wheels = ["WHEEL_FL", "WHEEL_FR", "WHEEL_RL", "WHEEL_RR"]
    .map((name) => bind(name, new THREE.Vector3(1, 0, 0)));
  const steeringControls = ["STEER_FL_CTRL", "STEER_FR_CTRL", "STEER_RL_CTRL", "STEER_RR_CTRL"]
    .map((name) => bind(name, new THREE.Vector3(0, 1, 0)));
  const suspensionControls = [bind("SUSP_L_CTRL", new THREE.Vector3(1, 0, 0)), bind("SUSP_R_CTRL", new THREE.Vector3(1, 0, 0))];
  const differentialControl = bind("DIFF_CTRL", new THREE.Vector3(0, 1, 0));
  const differentialLinks = [
    bindBallLink("LINK_L_CTRL", "LINK_L_TARGET"),
    bindBallLink("LINK_R_CTRL", "LINK_R_TARGET"),
  ];

  const neutralWheelCenters = wheels.map((wheel) => {
    const centerPosition = new THREE.Vector3();
    wheel?.node.getWorldPosition(centerPosition);
    return roverVisual.worldToLocal(centerPosition);
  });
  const leftRockerSpan = neutralWheelCenters[0].distanceTo(neutralWheelCenters[2]);
  const rightRockerSpan = neutralWheelCenters[1].distanceTo(neutralWheelCenters[3]);

  const pressed = new Set<string>();
  let steering = 0;
  let driveThrottle = 0;
  let driveBrake = 0;
  let tractionAssist = 0;
  let lowSpeedDemandTime = 0;
  let antiWheelieAssist = 0;
  let leftRocker = 0;
  let rightRocker = 0;
  let visualRoll = 0;
  let followCamera = true;
  let accumulator = 0;
  const clock = new THREE.Clock();
  const tempQuaternion = new THREE.Quaternion();
  const linkStartWorld = new THREE.Vector3();
  const linkTargetWorld = new THREE.Vector3();
  const linkStartInParent = new THREE.Vector3();
  const linkTargetInParent = new THREE.Vector3();
  const linkDirection = new THREE.Vector3();
  const linkSwing = new THREE.Quaternion();
  const driveQuaternion = new THREE.Quaternion();
  const driveForward = new THREE.Vector3();
  const drivePitchAxis = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const cameraFollowTarget = orbit.target.clone();
  const cameraTargetDelta = new THREE.Vector3();
  const bodyVisualQuaternion = new THREE.Quaternion();
  const visualYawQuaternion = new THREE.Quaternion();
  const visualRollQuaternion = new THREE.Quaternion();
  const visualForward = new THREE.Vector3();
  const visualForwardAxis = new THREE.Vector3(0, 0, -1);
  const visualRollAxis = new THREE.Vector3(0, 0, 1);
  const wheelWorldPositions = Array.from({ length: 4 }, () => new THREE.Vector3());
  const terrainWheelTargets = new Float64Array(4);

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
    if (block.type === "turn") {
      if (Math.abs(block.angle) < 0.01) return "GIRAR 0°";
      return `GIRAR ${block.angle > 0 ? "DER." : "IZQ."} ${Math.abs(Math.round(block.angle))}°`;
    }
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
    const zMin = TERRAIN.centerZ - TERRAIN.depth / 2;
    for (let py = 0; py < missionMapBackground.height; py += 1) {
      for (let px = 0; px < missionMapBackground.width; px += 1) {
        const x = -TERRAIN.width / 2 + (px / (missionMapBackground.width - 1)) * TERRAIN.width;
        const z = zMin + (py / (missionMapBackground.height - 1)) * TERRAIN.depth;
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
    y: ((z - (TERRAIN.centerZ - TERRAIN.depth / 2)) / TERRAIN.depth) * ui.missionMap.height,
  });

  const mapEventToWorld = (event: MouseEvent) => {
    const rect = ui.missionMap.getBoundingClientRect();
    const u = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const v = THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height, 0, 1);
    return {
      x: -TERRAIN.width / 2 + u * TERRAIN.width,
      z: TERRAIN.centerZ - TERRAIN.depth / 2 + v * TERRAIN.depth,
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

    context.font = "600 22px Barlow Condensed, sans-serif";
    context.textAlign = "right";
    context.textBaseline = "top";
    context.strokeStyle = "rgba(4, 7, 10, .92)";
    context.lineWidth = 5;
    context.strokeText("NORTE · −Z", ui.missionMap.width - 10, 9);
    context.fillStyle = "#81d9ff";
    context.fillText("NORTE · −Z", ui.missionMap.width - 10, 9);
    context.textBaseline = "bottom";
    context.strokeText("SUR · +Z", ui.missionMap.width - 10, ui.missionMap.height - 9);
    context.fillText("SUR · +Z", ui.missionMap.width - 10, ui.missionMap.height - 9);

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
    const mapAngle = Math.atan2(forward.x, -forward.z);
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

  const getMissionCommand = (): DriveCommand => {
    if (!mission.running || mission.paused) return { throttle: 0, steer: 0, brake: 0 };
    const block = missionBlocks[mission.index];
    if (!block) {
      stopMission(false, "COMPLETA");
      return { throttle: 0, steer: 0, brake: 0 };
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
        // Convención del programador: grados positivos giran a la derecha.
        mission.targetForward.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-block.angle));
      }
      renderMissionSequence();
    }

    if (block.type === "drive") {
      const traveled = Math.hypot(position.x - mission.startX, position.z - mission.startZ);
      const remaining = Math.max(0, block.distance - traveled);
      const speed = Math.abs(vehicle.currentVehicleSpeed());
      if (remaining <= 0.10 && speed <= 0.14) {
        completeMissionBlock();
        return { throttle: 0, steer: 0, brake: 0 };
      }
      const headingError = signedHeadingError(forward, mission.startForward);
      const steer = THREE.MathUtils.clamp(headingError / 0.42, -1, 1);
      const targetSpeed = THREE.MathUtils.clamp(Math.max(0, remaining - 0.06) * 1.22, 0, 1.65);
      const throttle = THREE.MathUtils.clamp((targetSpeed - speed) * 1.35, 0, AUTOPILOT_MAX_THROTTLE);
      const brake = THREE.MathUtils.clamp((speed - targetSpeed - 0.05) * 2.0, 0, 1);
      return { throttle: Math.abs(headingError) > 0.85 ? Math.min(0.14, throttle) : throttle, steer, brake };
    }

    if (block.type === "turn") {
      const headingError = signedHeadingError(forward, mission.targetForward);
      if (Math.abs(headingError) < THREE.MathUtils.degToRad(3.5)) {
        completeMissionBlock();
        return { throttle: 0, steer: 0, brake: 0 };
      }
      return {
        throttle: Math.abs(headingError) > 0.2 ? 0.28 : 0.16,
        steer: THREE.MathUtils.clamp(headingError / 0.38, -1, 1),
        brake: 0,
      };
    }

    const waypoint = waypoints.find((point) => point.id === block.waypointId);
    if (!waypoint) {
      completeMissionBlock();
      return { throttle: 0, steer: 0, brake: 0 };
    }
    const toTarget = new THREE.Vector3(waypoint.x - position.x, 0, waypoint.z - position.z);
    const distance = toTarget.length();
    const speed = Math.abs(vehicle.currentVehicleSpeed());
    if (distance < 0.34 && speed < 0.14) {
      completeMissionBlock();
      return { throttle: 0, steer: 0, brake: 0 };
    }
    toTarget.normalize();
    const headingError = signedHeadingError(forward, toTarget);
    const steer = THREE.MathUtils.clamp(headingError / 0.48, -1, 1);
    // En curvas se conserva un acelerador mínimo y solo se reduce la
    // velocidad objetivo. Antes se multiplicaba el acelerador por una
    // penalización que podía dejarlo en 12 % y detener el rover.
    const curveAmount = THREE.MathUtils.smoothstep(
      Math.abs(headingError),
      0.18,
      1.15,
    );
    const distanceTargetSpeed = THREE.MathUtils.clamp(
      Math.max(0, distance - 0.28) * 1.08,
      0,
      1.55,
    );
    const curveSpeedLimit = THREE.MathUtils.lerp(1.55, 0.85, curveAmount);
    const targetSpeed = Math.min(distanceTargetSpeed, curveSpeedLimit);
    const approach = THREE.MathUtils.clamp(
      (targetSpeed - speed) * 1.65,
      0,
      AUTOPILOT_MAX_THROTTLE,
    );
    const minimumCurveThrottle =
      distance > 0.65 && speed < Math.max(0.35, targetSpeed * 0.92)
        ? THREE.MathUtils.lerp(0.28, 0.48, curveAmount)
        : 0;
    const throttle = Math.max(approach, minimumCurveThrottle);

    // No frena mientras está corrigiendo una curva. El freno se habilita
    // únicamente cerca del waypoint y cuando el rover ya está orientado.
    const canBrake = distance < 1.05 && Math.abs(headingError) < 0.50;
    const brake = canBrake
      ? THREE.MathUtils.clamp((speed - targetSpeed - 0.08) * 1.4, 0, 1)
      : 0;
    return { throttle, steer, brake };
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
    orbit.enabled = true;
    orbit.enablePan = !followCamera;
    if (followCamera) cameraFollowTarget.copy(orbit.target);
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
    driveThrottle = 0;
    driveBrake = 0;
    tractionAssist = 0;
    lowSpeedDemandTime = 0;
    antiWheelieAssist = 0;
    leftRocker = 0;
    rightRocker = 0;
    visualRoll = 0;
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

  const alignBallLink = (binding: BallLinkBinding | null) => {
    if (!binding || !binding.node.parent) return;

    binding.node.getWorldPosition(linkStartWorld);
    binding.target.getWorldPosition(linkTargetWorld);
    binding.node.parent.worldToLocal(linkStartInParent.copy(linkStartWorld));
    binding.node.parent.worldToLocal(linkTargetInParent.copy(linkTargetWorld));
    linkDirection.subVectors(linkTargetInParent, linkStartInParent);
    const length = linkDirection.length();
    if (length < 0.000001) return;

    linkDirection.multiplyScalar(1 / length);
    linkSwing.setFromUnitVectors(binding.restDirection, linkDirection);
    binding.node.quaternion.copy(binding.base).premultiply(linkSwing);

    // Los dos tirantes del GLB están modelados a lo largo de su eje local X.
    // El ajuste longitudinal evita que la unión se abra cuando ambos laterales
    // se resuelven de forma independiente; la orientación sigue siendo libre,
    // como en una rótula esférica.
    binding.node.scale.copy(binding.baseScale);
    binding.node.scale.x *= length / binding.restLength;
  };

  const moveTowards = (current: number, target: number, maxDelta: number) => {
    if (current < target) return Math.min(current + maxDelta, target);
    return Math.max(current - maxDelta, target);
  };

  const updateVehicle = (dt: number) => {
    const manualThrottle = Number(pressed.has("KeyW")) - Number(pressed.has("KeyS"));
    const manualSteer = Number(pressed.has("KeyA")) - Number(pressed.has("KeyD"));
    const autonomous = getMissionCommand();
    const autopilotActive = mission.running && !mission.paused;
    const requestedThrottle = autopilotActive ? autonomous.throttle : manualThrottle;
    const steerInput = autopilotActive ? autonomous.steer : manualSteer;
    const speedNow = Math.abs(vehicle.currentVehicleSpeed());
    const speedRatio = THREE.MathUtils.clamp(speedNow / MAX_DRIVE_SPEED, 0, 1);
    const steeringLimit = THREE.MathUtils.lerp(0.47, 0.31, speedRatio);
    steering = THREE.MathUtils.damp(steering, steerInput * steeringLimit, 7, dt);
    const sameDirection = Math.sign(requestedThrottle) === Math.sign(driveThrottle) || Math.abs(driveThrottle) < 0.001;
    const increasing = sameDirection && Math.abs(requestedThrottle) > Math.abs(driveThrottle);
    const throttleRate = autonomous.brake > 0.01 ? 3.2 : increasing ? THROTTLE_RISE_RATE : THROTTLE_FALL_RATE;
    driveThrottle = moveTowards(driveThrottle, requestedThrottle, throttleRate * dt);

    const targetBrake = autopilotActive
      ? autonomous.brake * AUTOPILOT_BRAKE
      : Math.abs(manualThrottle) < 0.01 ? MANUAL_BRAKE : 0;
    driveBrake = moveTowards(driveBrake, targetBrake, (targetBrake > driveBrake ? 1.8 : 5.0) * dt);

    // Reserva progresiva de par: se activa al apuntar cuesta arriba o cuando
    // existe demanda de aceleración pero el rover permanece casi detenido.
    // La rampa independiente evita entregar de golpe todo el par de la caja.
    const bodyRotation = chassisBody.rotation();
    driveQuaternion.set(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w);
    driveForward.set(0, 0, -1).applyQuaternion(driveQuaternion);
    const driveDirection = Math.sign(driveThrottle);
    const uphillComponent = driveForward.y * driveDirection;
    const uphillAssist = THREE.MathUtils.clamp((uphillComponent - 0.025) / 0.27, 0, 1);
    const demandingTraction =
      Math.abs(requestedThrottle) > 0.18 &&
      speedNow < 0.55 &&
      driveBrake < 0.08;
    lowSpeedDemandTime = demandingTraction
      ? Math.min(lowSpeedDemandTime + dt, 1.5)
      : Math.max(lowSpeedDemandTime - dt * 2.2, 0);
    const stallAssist = THREE.MathUtils.smoothstep(lowSpeedDemandTime, 0.12, 0.55);
    const targetTractionAssist = Math.max(uphillAssist, stallAssist);
    tractionAssist = moveTowards(
      tractionAssist,
      targetTractionAssist,
      (targetTractionAssist > tractionAssist ? TRACTION_ASSIST_RISE_RATE : TRACTION_ASSIST_FALL_RATE) * dt,
    );
    const forcePerWheel = THREE.MathUtils.lerp(CRUISE_ENGINE_FORCE, CLIMB_ENGINE_FORCE, tractionAssist);

    // Control anti-caballito: observa los contactos del lado que avanza y la
    // velocidad de cabeceo. Si el frente comienza a levantarse, reduce el par
    // rápidamente y lo devuelve de forma gradual cuando las ruedas apoyan.
    const frontContacts = Number(vehicle.wheelIsInContact(0)) + Number(vehicle.wheelIsInContact(1));
    const rearContacts = Number(vehicle.wheelIsInContact(2)) + Number(vehicle.wheelIsInContact(3));
    const leadingContacts = driveDirection >= 0 ? frontContacts : rearContacts;
    const trailingContacts = driveDirection >= 0 ? rearContacts : frontContacts;
    const angularVelocity = chassisBody.angvel();
    drivePitchAxis.set(1, 0, 0).applyQuaternion(driveQuaternion);
    const noseUpRate =
      (angularVelocity.x * drivePitchAxis.x + angularVelocity.y * drivePitchAxis.y + angularVelocity.z * drivePitchAxis.z) *
      driveDirection;
    const contactLift = Math.abs(driveThrottle) > 0.08 && trailingContacts > 0
      ? leadingContacts === 0 ? 1 : leadingContacts === 1 ? 0.28 : 0
      : 0;
    const pitchLift = Math.abs(driveThrottle) > 0.08
      ? THREE.MathUtils.clamp((noseUpRate - 0.16) / 0.82, 0, 1)
      : 0;
    const targetAntiWheelie = Math.max(contactLift, pitchLift);
    antiWheelieAssist = moveTowards(
      antiWheelieAssist,
      targetAntiWheelie,
      (targetAntiWheelie > antiWheelieAssist ? ANTI_WHEELIE_RISE_RATE : ANTI_WHEELIE_FALL_RATE) * dt,
    );
    const antiWheelieTorqueScale = THREE.MathUtils.lerp(1, ANTI_WHEELIE_MIN_TORQUE_SCALE, antiWheelieAssist);
    // Limitador suave: conserva todo el empuje hasta los últimos 0,32 m/s y
    // lo reduce progresivamente al acercarse al máximo. Así el rover acelera
    // con decisión sin oscilar por un corte brusco de motor.
    const speedLimitFactor = THREE.MathUtils.smoothstep(MAX_DRIVE_SPEED - speedNow, 0, 0.32);
    const engineForce = driveThrottle * -forcePerWheel * antiWheelieTorqueScale * speedLimitFactor;

    // Impulso equivalente a una fuerza vertical de corta duración. Solo se
    // activa mientras faltan contactos, por lo que no aplasta continuamente
    // la suspensión cuando las cuatro ruedas ya están apoyadas.
    const missingContacts = 4 - frontContacts - rearContacts;
    if (missingContacts > 0) {
      chassisBody.applyImpulse(
        { x: 0, y: -CONTACT_RECOVERY_FORCE_PER_WHEEL * missingContacts * dt, z: 0 },
        true,
      );
    }

    if (Math.abs(driveThrottle) > 0.001 || steerInput !== 0) chassisBody.wakeUp();

    for (let index = 0; index < 4; index += 1) {
      vehicle.setWheelEngineForce(index, engineForce);
      vehicle.setWheelBrake(index, driveBrake);
      vehicle.setWheelSteering(index, index < 2 ? steering : -steering * 0.68);
    }
    vehicle.updateVehicle(dt);
    world.step();
  };

  const setKinematicVisualPose = (x: number, z: number, roll: number, height: number) => {
    visualRollQuaternion.setFromAxisAngle(visualRollAxis, roll);
    roverVisual.position.set(x, height, z);
    roverVisual.quaternion.copy(visualYawQuaternion).multiply(visualRollQuaternion);
    roverVisual.updateMatrixWorld(true);
  };

  const updateVisualWheelPositions = () => {
    model.updateMatrixWorld(true);
    wheels.forEach((wheel, index) => {
      wheel?.node.getWorldPosition(wheelWorldPositions[index]);
    });
  };

  const sampleTerrainUnderVisualWheels = () => {
    updateVisualWheelPositions();
    wheelWorldPositions.forEach((wheelPosition, index) => {
      terrainWheelTargets[index] = terrainHeight(wheelPosition.x, wheelPosition.z) + WHEEL_RADIUS;
    });
  };

  const solveIndependentRockerAngles = () => {
    const maxNormalizedDifference = Math.sin(MAX_INDEPENDENT_ROCKER_ANGLE);
    const leftDifference = THREE.MathUtils.clamp(
      (terrainWheelTargets[0] - terrainWheelTargets[2]) / leftRockerSpan,
      -maxNormalizedDifference,
      maxNormalizedDifference,
    );
    const rightDifference = THREE.MathUtils.clamp(
      (terrainWheelTargets[1] - terrainWheelTargets[3]) / rightRockerSpan,
      -maxNormalizedDifference,
      maxNormalizedDifference,
    );
    leftRocker = Math.asin(leftDifference);
    rightRocker = Math.asin(rightDifference);
    applyBinding(suspensionControls[0], leftRocker);
    applyBinding(suspensionControls[1], rightRocker);
    model.updateMatrixWorld(true);
  };

  const measureVisualSideHeightDifference = (x: number, z: number, roll: number) => {
    setKinematicVisualPose(x, z, roll, 0);
    updateVisualWheelPositions();
    const leftMean = (wheelWorldPositions[0].y + wheelWorldPositions[2].y) * 0.5;
    const rightMean = (wheelWorldPositions[1].y + wheelWorldPositions[3].y) * 0.5;
    return rightMean - leftMean;
  };

  const solveVisualRoll = (x: number, z: number) => {
    const targetDifference =
      (terrainWheelTargets[1] + terrainWheelTargets[3] - terrainWheelTargets[0] - terrainWheelTargets[2]) * 0.5;
    let angle = visualRoll;
    const epsilon = 0.004;

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const currentDifference = measureVisualSideHeightDifference(x, z, angle);
      const probeAngle = angle < MAX_VISUAL_ROLL - epsilon ? angle + epsilon : angle - epsilon;
      const probeDifference = measureVisualSideHeightDifference(x, z, probeAngle);
      const derivative = (probeDifference - currentDifference) / (probeAngle - angle);
      if (Math.abs(derivative) < 0.05) break;
      angle = THREE.MathUtils.clamp(
        angle - (currentDifference - targetDifference) / derivative,
        -MAX_VISUAL_ROLL,
        MAX_VISUAL_ROLL,
      );
    }

    visualRoll = angle;
    setKinematicVisualPose(x, z, visualRoll, 0);
  };

  const updateVisuals = (dt: number) => {
    const position = chassisBody.translation();
    const rotation = chassisBody.rotation();
    bodyVisualQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    visualForward.copy(visualForwardAxis).applyQuaternion(bodyVisualQuaternion);
    visualForward.y = 0;
    if (visualForward.lengthSq() > 0.000001) {
      visualForward.normalize();
      const yaw = Math.atan2(-visualForward.x, -visualForward.z);
      visualYawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    }

    steeringControls.forEach((control, index) => applyBinding(control, index < 2 ? steering : -steering * 0.68));
    wheels.forEach((wheel, index) => applyBinding(wheel, vehicle.wheelRotation(index) ?? 0));

    // Cinemática visual independiente. Cada SUSP_* rota como un conjunto
    // rígido desde su propio pivote; no se traslada STEER_* ni ninguna rueda,
    // por lo que los soportes y brazos nunca pueden abrirse entre sí.
    for (let pass = 0; pass < 3; pass += 1) {
      setKinematicVisualPose(position.x, position.z, visualRoll, 0);
      applyBinding(suspensionControls[0], leftRocker);
      applyBinding(suspensionControls[1], rightRocker);
      sampleTerrainUnderVisualWheels();
      solveIndependentRockerAngles();
      solveVisualRoll(position.x, position.z);
    }

    // Solo se desplaza el rover completo en vertical. Así las cuatro llantas
    // quedan sobre el terreno conservando intacta toda la jerarquía mecánica.
    setKinematicVisualPose(position.x, position.z, visualRoll, 0);
    applyBinding(suspensionControls[0], leftRocker);
    applyBinding(suspensionControls[1], rightRocker);
    // El pivote diferencial acompaña visualmente la diferencia entre ambos
    // balancines. No modifica sus ángulos ni participa en la física, por lo que
    // un lateral nunca levanta la rueda del contrario.
    const differentialAngle = THREE.MathUtils.clamp(
      (rightRocker - leftRocker) * 0.2,
      -MAX_DIFFERENTIAL_ANGLE,
      MAX_DIFFERENTIAL_ANGLE,
    );
    applyBinding(differentialControl, differentialAngle);
    model.updateMatrixWorld(true);
    differentialLinks.forEach(alignBallLink);
    model.updateMatrixWorld(true);
    sampleTerrainUnderVisualWheels();
    const visualHeight = wheelWorldPositions.reduce(
      (sum, wheelPosition, index) => sum + terrainWheelTargets[index] - wheelPosition.y,
      0,
    ) / wheelWorldPositions.length;
    setKinematicVisualPose(position.x, position.z, visualRoll, visualHeight);

    const lengths = [0, 1, 2, 3].map((index) => vehicle.wheelSuspensionLength(index) ?? SUSPENSION_REST);

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
      // El objetivo persigue suavemente al rover. La cámara recibe exactamente
      // el mismo desplazamiento, por lo que conserva el ángulo y el zoom que
      // el usuario haya elegido con OrbitControls.
      cameraTarget.set(position.x, position.y + 0.32, position.z);
      cameraFollowTarget.lerp(cameraTarget, 1 - Math.exp(-dt * 6));
      cameraTargetDelta.subVectors(cameraFollowTarget, orbit.target);
      camera.position.add(cameraTargetDelta);
      orbit.target.copy(cameraFollowTarget);
      orbit.enablePan = false;
    } else {
      orbit.enablePan = true;
    }
    orbit.update();
  };

  resetRover();
  ui.loading.classList.add("hidden");
  console.info("[rover] simulación lista", {
    physicsHz: PHYSICS_HZ,
    model: MODEL_URL,
    drivetrain: {
      motors: MOTOR_COUNT,
      motorTorqueNm: MOTOR_TORQUE_NM,
      gearRatio: GEAR_RATIO,
      wheelTorqueNm: Number(WHEEL_TORQUE_NM.toFixed(1)),
      theoreticalForcePerWheelN: Number(THEORETICAL_WHEEL_FORCE_N.toFixed(1)),
      tractionLimitedForcePerWheelN: Number(CLIMB_ENGINE_FORCE.toFixed(1)),
    },
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
    marsSky.position.copy(camera.position);
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

function createMarsSky(scene: THREE.Scene) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenithColor: { value: new THREE.Color(MARS_SKY_COLORS.zenith) },
      horizonColor: { value: new THREE.Color(MARS_SKY_COLORS.horizon) },
      groundColor: { value: new THREE.Color(MARS_SKY_COLORS.ground) },
      sunColor: { value: new THREE.Color(MARS_SKY_COLORS.sun) },
    },
    vertexShader: `
      varying vec3 vDirection;

      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      uniform vec3 sunColor;
      varying vec3 vDirection;

      void main() {
        vec3 direction = normalize(vDirection);
        float height = direction.y;

        vec3 lowerSky = mix(
          groundColor,
          horizonColor,
          smoothstep(-0.58, 0.02, height)
        );
        vec3 upperSky = mix(
          horizonColor,
          zenithColor,
          smoothstep(-0.02, 0.92, height)
        );
        vec3 skyColor = mix(lowerSky, upperSky, step(0.0, height));

        // Bruma de polvo en la línea del horizonte.
        float horizonHaze = pow(max(0.0, 1.0 - abs(height)), 5.0);
        skyColor = mix(skyColor, horizonColor, horizonHaze * 0.46);

        // Resplandor solar suave, sin usar una imagen externa.
        vec3 sunDirection = normalize(vec3(-0.48, 0.31, -0.82));
        float sunGlow = pow(max(dot(direction, sunDirection), 0.0), 72.0);
        float sunCore = pow(max(dot(direction, sunDirection), 0.0), 520.0);
        skyColor += sunColor * (sunGlow * 0.24 + sunCore * 0.72);

        gl_FragColor = vec4(skyColor, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(82, 48, 28), material);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

function createMarsHorizonGround(scene: THREE.Scene) {
  // Plano puramente visual bajo el terreno físico. Evita que en los bordes
  // aparezca el vacío y se pierde gradualmente dentro de la neblina marciana.
  const horizonGround = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshBasicMaterial({
      color: MARS_SKY_COLORS.ground,
      fog: true,
    }),
  );
  horizonGround.rotation.x = -Math.PI / 2;
  horizonGround.position.set(0, -1.15, TERRAIN.centerZ);
  horizonGround.renderOrder = -10;
  scene.add(horizonGround);
}

function applyRoverComponentColors(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const hierarchyNames: string[] = [];
    let current: THREE.Object3D | null = object;
    while (current) {
      hierarchyNames.push(current.name.toUpperCase());
      if (current === root) break;
      current = current.parent;
    }

    const hierarchyPath = hierarchyNames.join("/");
    const component = ROVER_COMPONENT_MATCHERS.find(([, matcher]) => matcher.test(hierarchyPath))?.[0];
    if (!component) return;

    const color = ROVER_COMPONENT_COLORS[component];
    if (color === null) return;

    const recolorMaterial = (source: THREE.Material) => {
      const material = source.clone() as THREE.Material & { color?: THREE.Color };
      material.color?.set(color);
      material.needsUpdate = true;
      return material;
    };

    object.material = Array.isArray(object.material)
      ? object.material.map(recolorMaterial)
      : recolorMaterial(object.material);
  });
}

function createMarsSurfaceTextures(renderer: THREE.WebGLRenderer) {
  const textureWidth = 1024;
  const textureHeight = 1536;
  const albedoCanvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  albedoCanvas.width = bumpCanvas.width = textureWidth;
  albedoCanvas.height = bumpCanvas.height = textureHeight;
  const albedoContext = albedoCanvas.getContext("2d")!;
  const bumpContext = bumpCanvas.getContext("2d")!;
  const albedoImage = albedoContext.createImageData(textureWidth, textureHeight);
  const bumpImage = bumpContext.createImageData(textureWidth, textureHeight);

  // Generador determinista: el aspecto del suelo no cambia en cada recarga.
  let seed = 0x4d415253;
  const random = () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };

  const dark = { r: 102, g: 39, b: 22 };
  const light = { r: 205, g: 105, b: 55 };
  let offset = 0;
  for (let y = 0; y < textureHeight; y += 1) {
    const v = y / (textureHeight - 1);
    for (let x = 0; x < textureWidth; x += 1) {
      const u = x / (textureWidth - 1);
      const broad =
        Math.sin(u * 13.1 + v * 4.7) * 0.10 +
        Math.cos(v * 19.3 - u * 3.8) * 0.08 +
        Math.sin((u + v) * 41.0) * 0.035;
      const fine =
        Math.sin(u * 173.0 + v * 29.0) * 0.020 +
        Math.cos(v * 211.0 - u * 47.0) * 0.016;
      const grain = (random() + random() + random() - 1.5) / 1.5;
      const tone = THREE.MathUtils.clamp(0.52 + broad + fine + grain * 0.065, 0.08, 0.96);

      albedoImage.data[offset] = dark.r + (light.r - dark.r) * tone;
      albedoImage.data[offset + 1] = dark.g + (light.g - dark.g) * tone;
      albedoImage.data[offset + 2] = dark.b + (light.b - dark.b) * tone;
      albedoImage.data[offset + 3] = 255;

      const relief = THREE.MathUtils.clamp(0.50 + fine * 2.4 + grain * 0.16, 0, 1) * 255;
      bumpImage.data[offset] = relief;
      bumpImage.data[offset + 1] = relief;
      bumpImage.data[offset + 2] = relief;
      bumpImage.data[offset + 3] = 255;
      offset += 4;
    }
  }
  albedoContext.putImageData(albedoImage, 0, 0);
  bumpContext.putImageData(bumpImage, 0, 0);

  // Motas minerales, grava muy fina y vetas de viento integradas en la
  // textura. Son detalle visual: no agregan obstáculos encima del terreno.
  for (let index = 0; index < 2100; index += 1) {
    const x = random() * textureWidth;
    const y = random() * textureHeight;
    const radius = 0.35 + random() * 1.8;
    const opacity = 0.08 + random() * 0.20;
    albedoContext.beginPath();
    albedoContext.ellipse(x, y, radius * (0.7 + random()), radius, random() * Math.PI, 0, Math.PI * 2);
    albedoContext.fillStyle = random() > 0.28
      ? `rgba(48, 18, 10, ${opacity})`
      : `rgba(244, 151, 84, ${opacity * 0.7})`;
    albedoContext.fill();

    bumpContext.beginPath();
    bumpContext.arc(x, y, radius, 0, Math.PI * 2);
    const bumpShade = random() > 0.5 ? 65 : 205;
    const bumpOpacity = bumpShade === 65 ? 0.34 : 0.20;
    bumpContext.fillStyle = `rgba(${bumpShade}, ${bumpShade}, ${bumpShade}, ${bumpOpacity})`;
    bumpContext.fill();
  }

  for (let index = 0; index < 95; index += 1) {
    const x = random() * textureWidth;
    const y = random() * textureHeight;
    const radius = 2.0 + random() * 7.5;
    const flatten = 0.42 + random() * 0.36;
    const angle = random() * Math.PI;

    albedoContext.save();
    albedoContext.translate(x, y);
    albedoContext.rotate(angle);
    albedoContext.scale(1, flatten);
    const craterColor = albedoContext.createRadialGradient(0, 0, 0, 0, 0, radius);
    craterColor.addColorStop(0, "rgba(43, 14, 8, .42)");
    craterColor.addColorStop(0.58, "rgba(61, 19, 10, .30)");
    craterColor.addColorStop(0.78, "rgba(232, 126, 65, .20)");
    craterColor.addColorStop(1, "rgba(232, 126, 65, 0)");
    albedoContext.fillStyle = craterColor;
    albedoContext.beginPath();
    albedoContext.arc(0, 0, radius, 0, Math.PI * 2);
    albedoContext.fill();
    albedoContext.restore();

    bumpContext.save();
    bumpContext.translate(x, y);
    bumpContext.rotate(angle);
    bumpContext.scale(1, flatten);
    const craterRelief = bumpContext.createRadialGradient(0, 0, 0, 0, 0, radius);
    craterRelief.addColorStop(0, "rgba(38, 38, 38, .72)");
    craterRelief.addColorStop(0.58, "rgba(72, 72, 72, .48)");
    craterRelief.addColorStop(0.80, "rgba(225, 225, 225, .46)");
    craterRelief.addColorStop(1, "rgba(128, 128, 128, 0)");
    bumpContext.fillStyle = craterRelief;
    bumpContext.beginPath();
    bumpContext.arc(0, 0, radius, 0, Math.PI * 2);
    bumpContext.fill();
    bumpContext.restore();
  }

  for (let index = 0; index < 150; index += 1) {
    const x = random() * textureWidth;
    const y = random() * textureHeight;
    const length = 18 + random() * 85;
    albedoContext.beginPath();
    albedoContext.moveTo(x, y);
    albedoContext.lineTo(x + length, y + length * (0.04 + random() * 0.05));
    albedoContext.strokeStyle = `rgba(255, 177, 108, ${0.018 + random() * 0.025})`;
    albedoContext.lineWidth = 0.5 + random();
    albedoContext.stroke();
  }

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  bump.anisotropy = albedo.anisotropy;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  bump.minFilter = THREE.LinearMipmapLinearFilter;
  return { albedo, bump };
}

function createMarsTerrain(scene: THREE.Scene, world: RAPIER.World, renderer: THREE.WebGLRenderer) {
  const { width, depth, centerZ } = TERRAIN;
  const xSegments = 84;
  const zSegments = 132;
  const rowSize = xSegments + 1;
  const vertexCount = rowSize * (zSegments + 1);
  const vertices = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(xSegments * zSegments * 6);

  let vertexOffset = 0;
  let uvOffset = 0;
  const darkSand = new THREE.Color(0xc08a74);
  const lightSand = new THREE.Color(0xffd1ad);
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

      uvs[uvOffset] = xIndex / xSegments;
      uvs[uvOffset + 1] = 1 - zIndex / zSegments;
      uvOffset += 2;
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
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const surfaceTextures = createMarsSurfaceTextures(renderer);
  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: surfaceTextures.albedo,
      bumpMap: surfaceTextures.bump,
      bumpScale: 0.045,
      vertexColors: true,
      roughness: 0.96,
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
