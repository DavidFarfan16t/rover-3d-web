import * as THREE from "three";

type RoverComponentName = "chassis" | "suspension" | "steering" | "motors" | "wheels";

const ROVER_COMPONENT_COLORS: Record<RoverComponentName, string | null> = {
  chassis: "#7a7f85",
  suspension: null,
  steering: "#d21f26",
  motors: null,
  wheels: "#050505",
};

const ROVER_COMPONENT_MATCHERS: Array<[RoverComponentName, RegExp]> = [
  ["wheels", /WHEEL_(FL|FR|RL|RR)|RUEDA 2/],
  ["motors", /3D-AK80|MOTOR AK/],
  ["steering", /STEER_/],
  ["suspension", /SUSP_|ARTICULACION|DIFERENCIAAL|LINK_|FIXED_/],
  ["chassis", /CHASIS/],
];

export type ControlBinding = {
  node: THREE.Object3D;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
};

export type BallLinkBinding = {
  node: THREE.Object3D;
  target: THREE.Object3D;
  base: THREE.Quaternion;
  baseScale: THREE.Vector3;
  restDirection: THREE.Vector3;
  restLength: number;
};

const tempQuaternion = new THREE.Quaternion();
const linkStartWorld = new THREE.Vector3();
const linkTargetWorld = new THREE.Vector3();
const linkStartInParent = new THREE.Vector3();
const linkTargetInParent = new THREE.Vector3();
const linkDirection = new THREE.Vector3();
const linkSwing = new THREE.Quaternion();

export function applyRoverComponentColors(root: THREE.Object3D) {
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

export function bindControl(
  model: THREE.Object3D,
  name: string,
  desiredModelAxis: THREE.Vector3,
): ControlBinding | null {
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
}

export function bindBallLink(
  model: THREE.Object3D,
  controlName: string,
  targetName: string,
): BallLinkBinding | null {
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
}

export function applyBinding(binding: ControlBinding | null, angle: number) {
  if (!binding) return;
  tempQuaternion.setFromAxisAngle(binding.axis, angle);
  binding.node.quaternion.copy(binding.base).premultiply(tempQuaternion);
}

export function alignBallLink(binding: BallLinkBinding | null) {
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
  // El ajuste longitudinal conserva cerrada la unión al resolver ambos lados.
  binding.node.scale.copy(binding.baseScale);
  binding.node.scale.x *= length / binding.restLength;
}
