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
const SUSPENSION_REST = 0.17;
const START = { x: 0, y: 0.62, z: 4.2 };

type ControlBinding = {
  node: THREE.Object3D;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
};

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
  scene.fog = new THREE.Fog(0x071019, 13, 34);

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

  createTestTrack(scene, world);

  const chassisBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(START.x, START.y, START.z)
      .setLinearDamping(0.18)
      .setAngularDamping(1.35)
      // El controlador raycast aplica fuerzas externas. Si Rapier duerme el
      // chasis mientras el GLB termina de cargar, esas fuerzas pueden no
      // arrancar el rover hasta hacer un reinicio manual.
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(12),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.43, 0.12, 0.46)
      .setTranslation(0, 0.06, 0)
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
    vehicle.setWheelSuspensionStiffness(index, 36);
    vehicle.setWheelSuspensionCompression(index, 4.5);
    vehicle.setWheelSuspensionRelaxation(index, 5.5);
    vehicle.setWheelMaxSuspensionTravel(index, 0.14);
    vehicle.setWheelMaxSuspensionForce(index, 4200);
    vehicle.setWheelFrictionSlip(index, 3.1);
    vehicle.setWheelSideFrictionStiffness(index, 0.88);
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

  const setPressed = (code: string, value: boolean) => {
    if (value) pressed.add(code);
    else pressed.delete(code);
    if (value && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(code)) {
      chassisBody.wakeUp();
    }
    document.querySelectorAll<HTMLButtonElement>(`[data-key="${code}"]`).forEach((button) => button.classList.toggle("active", value));
  };

  const toggleCamera = () => {
    followCamera = !followCamera;
    orbit.enabled = !followCamera;
    ui.cameraButton.textContent = `CÁMARA: ${followCamera ? "SEGUIMIENTO" : "ÓRBITA LIBRE"}`;
  };

  const resetRover = () => {
    ["KeyW", "KeyA", "KeyS", "KeyD"].forEach((code) => setPressed(code, false));
    accumulator = 0;
    chassisBody.setTranslation(START, true);
    chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    steering = 0;
    leftRocker = 0;
    rightRocker = 0;
    for (let index = 0; index < 4; index += 1) {
      vehicle.setWheelEngineForce(index, 0);
      vehicle.setWheelBrake(index, 0);
      vehicle.setWheelSteering(index, 0);
    }
    chassisBody.wakeUp();
  };

  window.addEventListener("keydown", (event) => {
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
  ui.resetButton.addEventListener("click", resetRover);

  const applyBinding = (binding: ControlBinding | null, angle: number) => {
    if (!binding) return;
    tempQuaternion.setFromAxisAngle(binding.axis, angle);
    binding.node.quaternion.copy(binding.base).premultiply(tempQuaternion);
  };

  const updateVehicle = (dt: number) => {
    const throttle = Number(pressed.has("KeyW")) - Number(pressed.has("KeyS"));
    const steerInput = Number(pressed.has("KeyA")) - Number(pressed.has("KeyD"));
    const speedNow = Math.abs(vehicle.currentVehicleSpeed());
    const speedRatio = THREE.MathUtils.clamp(speedNow / 1.7, 0, 1);
    const steeringLimit = THREE.MathUtils.lerp(0.47, 0.31, speedRatio);
    steering = THREE.MathUtils.damp(steering, steerInput * steeringLimit, 7, dt);
    const engineForce = speedNow < 1.7 ? throttle * -38 : 0;
    const brake = throttle === 0 ? 1.5 : 0;

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
    const leftTarget = THREE.MathUtils.clamp((lengths[2] - lengths[0]) * 2.6, -0.38, 0.38);
    const rightTarget = THREE.MathUtils.clamp((lengths[1] - lengths[3]) * 2.6, -0.38, 0.38);
    leftRocker = THREE.MathUtils.damp(leftRocker, leftTarget, 9, dt);
    rightRocker = THREE.MathUtils.damp(rightRocker, rightTarget, 9, dt);
    applyBinding(suspensionControls[0], leftRocker);
    applyBinding(suspensionControls[1], rightRocker);
    if (differential && differentialBase) {
      tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (leftRocker - rightRocker) * 0.42);
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

function createTestTrack(scene: THREE.Scene, world: RAPIER.World) {
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.08, -3));
  world.createCollider(RAPIER.ColliderDesc.cuboid(12, 0.08, 17).setFriction(1.25).setRestitution(0), groundBody);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 34, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4a2116, roughness: 0.92, metalness: 0.02 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0.002, -3);
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(24, 24, 0xb85832, 0x73351f);
  grid.position.set(0, 0.008, -3);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.32; });
  scene.add(grid);

  const addBox = (
    position: THREE.Vector3,
    size: THREE.Vector3,
    rotation: THREE.Euler,
    color: number,
  ) => {
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setFriction(1.2).setRestitution(0),
      body,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshStandardMaterial({ color, roughness: 0.88 }),
    );
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };

  // Obstáculos alternados: primero trabaja el lado izquierdo, luego el derecho.
  addBox(new THREE.Vector3(-0.48, 0.085, 1.15), new THREE.Vector3(0.54, 0.17, 1.15), new THREE.Euler(0, 0, 0.04), 0x8d4227);
  addBox(new THREE.Vector3(0.48, 0.12, -1.0), new THREE.Vector3(0.56, 0.24, 1.2), new THREE.Euler(0, 0, -0.05), 0xa34c2a);
  addBox(new THREE.Vector3(-0.46, 0.16, -3.35), new THREE.Vector3(0.62, 0.32, 1.25), new THREE.Euler(0, 0, 0.06), 0x78351f);

  // Rampa completa para comprobar estabilidad y frenado.
  addBox(new THREE.Vector3(0, 0.14, -6.2), new THREE.Vector3(1.7, 0.16, 2.2), new THREE.Euler(-0.12, 0, 0), 0x6f321f);

  // Rocas visuales laterales para dar escala sin bloquear el recorrido principal.
  [
    new THREE.Vector3(-2.6, 0.22, 0.4),
    new THREE.Vector3(2.8, 0.18, -2.4),
    new THREE.Vector3(-3.2, 0.26, -6.8),
  ].forEach((position, index) => {
    const radius = 0.28 + index * 0.05;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z));
    world.createCollider(RAPIER.ColliderDesc.ball(radius * 0.8).setFriction(1.1).setRestitution(0), body);
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(radius, 1),
      new THREE.MeshStandardMaterial({ color: 0x522419, roughness: 1 }),
    );
    rock.position.copy(position);
    rock.scale.set(1.35, 0.72, 1);
    rock.rotation.set(index * 0.4, index * 0.8, 0.1);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  });
}

start().catch((error: unknown) => {
  console.error(error);
  ui.loadingStatus.textContent = "No se pudo iniciar. Revisa la consola del navegador.";
});
