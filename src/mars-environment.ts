import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  MARS_SKY_COLORS,
  PHYSICS_TILE_RADIUS,
  START,
  TERRAIN,
  TERRAIN_X_MIN,
  TERRAIN_Z_MIN,
  VISUAL_TILE_RADIUS,
} from "./config";

const positiveModulo = (value: number, period: number) => ((value % period) + period) % period;

const wrapCoordinate = (value: number, minimum: number, period: number) =>
  minimum + positiveModulo(value - minimum, period);

// Diferencia más corta entre dos posiciones de un mundo cuyos bordes están
// unidos. El resultado siempre queda entre -periodo/2 y +periodo/2.
export const periodicDelta = (value: number, reference: number, period: number) =>
  positiveModulo(value - reference + period / 2, period) - period / 2;

export const wrapTerrainX = (x: number) => wrapCoordinate(x, TERRAIN_X_MIN, TERRAIN.width);
export const wrapTerrainZ = (z: number) => wrapCoordinate(z, TERRAIN_Z_MIN, TERRAIN.depth);

const gaussian = (x: number, z: number, cx: number, cz: number, radius: number, height: number) => {
  const dx = periodicDelta(x, cx, TERRAIN.width);
  const dz = periodicDelta(z, cz, TERRAIN.depth);
  return height * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
};

export const terrainHeight = (x: number, z: number) => {
  // Todas las frecuencias son enteras dentro del periodo X/Z. De esta manera
  // la altura y su pendiente coinciden exactamente en los bordes opuestos.
  const u = ((x - TERRAIN_X_MIN) / TERRAIN.width) * Math.PI * 2;
  const v = ((z - TERRAIN_Z_MIN) / TERRAIN.depth) * Math.PI * 2;
  const rolling =
    Math.sin(u * 2 + v) * 0.19 +
    Math.cos(v * 2 - u) * 0.17 +
    Math.sin(u * 3 + v * 2) * 0.09;

  const formations =
    gaussian(x, z, -4.5, 0.3, 2.8, 0.82) +
    gaussian(x, z, 4.2, -2.4, 2.5, 0.70) +
    gaussian(x, z, -1.0, -9.0, 3.6, 0.95) +
    gaussian(x, z, 5.0, -14.0, 3.1, 0.78) -
    gaussian(x, z, -2.0, -2.5, 1.7, 0.42) -
    gaussian(x, z, 3.1, -7.0, 2.0, 0.48) -
    gaussian(x, z, -5.0, -13.0, 2.5, 0.55);

  // Montículos estrechos del tamaño aproximado de una rueda, distribuidos por
  // todo el mapa. Cada uno puede levantar un solo lateral de la suspensión.
  const singleWheelBumps =
    // Zona norte.
    gaussian(x, z, -11.3, 14.1, 0.52, 0.29) +
    gaussian(x, z, -6.9, 12.3, 0.48, 0.27) +
    gaussian(x, z, -1.8, 14.8, 0.54, 0.31) +
    gaussian(x, z, 4.4, 12.5, 0.50, 0.28) +
    gaussian(x, z, 10.7, 14.7, 0.56, 0.32) +
    gaussian(x, z, -9.8, 6.5, 0.55, 0.31) +
    gaussian(x, z, 7.2, 6.1, 0.47, 0.26) +
    gaussian(x, z, 12.1, 8.0, 0.49, 0.30) +

    // Zona central y recorrido inicial.
    gaussian(x, z, -0.55, 1.15, 0.52, 0.29) +
    gaussian(x, z, 0.55, -0.75, 0.50, 0.32) +
    gaussian(x, z, -0.55, -2.75, 0.51, 0.30) +
    gaussian(x, z, 0.55, -4.80, 0.52, 0.33) +
    gaussian(x, z, -0.55, -6.85, 0.49, 0.31) +
    gaussian(x, z, -12.2, 0.8, 0.46, 0.27) +
    gaussian(x, z, 9.6, 0.2, 0.53, 0.33) +
    gaussian(x, z, -8.6, -4.5, 0.50, 0.29) +
    gaussian(x, z, 11.6, -5.9, 0.48, 0.26) +
    gaussian(x, z, 5.5, -8.2, 0.45, 0.25) +
    gaussian(x, z, -2.0, -12.9, 0.50, 0.28) +

    // Zona sur.
    gaussian(x, z, -11.2, -10.1, 0.56, 0.34) +
    gaussian(x, z, 8.9, -11.6, 0.51, 0.30) +
    gaussian(x, z, -7.9, -16.0, 0.47, 0.27) +
    gaussian(x, z, 2.7, -18.5, 0.57, 0.32) +
    gaussian(x, z, 10.7, -20.1, 0.50, 0.29) +
    gaussian(x, z, -12.0, -23.2, 0.54, 0.31) +
    gaussian(x, z, -4.0, -24.7, 0.46, 0.25) +
    gaussian(x, z, 5.8, -25.0, 0.52, 0.30);

  const fine =
    Math.sin(u * 7 + v * 5) * 0.028 +
    Math.sin(u * 11 - v * 8) * 0.016;

  const spawnDistance = Math.hypot(
    periodicDelta(x, START.x, TERRAIN.width),
    periodicDelta(z, START.z, TERRAIN.depth),
  );
  const terrainBlend = THREE.MathUtils.smoothstep(spawnDistance, 1.35, 3.4);
  return (rolling + formations + singleWheelBumps + fine) * terrainBlend;
};

export function createMarsSky(scene: THREE.Scene) {
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

export function createMarsHorizonGround(scene: THREE.Scene) {
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
  const textureTau = Math.PI * 2;
  let offset = 0;
  for (let y = 0; y < textureHeight; y += 1) {
    const v = y / (textureHeight - 1);
    for (let x = 0; x < textureWidth; x += 1) {
      const u = x / (textureWidth - 1);
      const broad =
        Math.sin((u * 2 + v) * textureTau) * 0.10 +
        Math.cos((v * 3 - u) * textureTau) * 0.08 +
        Math.sin((u * 5 + v * 4) * textureTau) * 0.035;
      const fine =
        Math.sin((u * 29 + v * 7) * textureTau) * 0.020 +
        Math.cos((v * 31 - u * 11) * textureTau) * 0.016;
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
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  bump.anisotropy = albedo.anisotropy;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  bump.minFilter = THREE.LinearMipmapLinearFilter;
  return { albedo, bump };
}

export function createMarsTerrain(scene: THREE.Scene, world: RAPIER.World, renderer: THREE.WebGLRenderer) {
  const { width, depth, centerZ } = TERRAIN;
  const xSegments = 84;
  const zSegments = 132;
  const rowSize = xSegments + 1;
  const vertexCount = rowSize * (zSegments + 1);
  const vertices = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(xSegments * zSegments * 6);

  let vertexOffset = 0;
  let uvOffset = 0;
  const darkSand = new THREE.Color(0xc08a74);
  const lightSand = new THREE.Color(0xffd1ad);
  const vertexColor = new THREE.Color();
  const vertexNormal = new THREE.Vector3();
  const normalEpsilon = 0.035;

  for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
    const z = centerZ - depth / 2 + (zIndex / zSegments) * depth;
    for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
      const x = -width / 2 + (xIndex / xSegments) * width;
      const y = terrainHeight(x, z);
      vertices[vertexOffset] = x;
      vertices[vertexOffset + 1] = y;
      vertices[vertexOffset + 2] = z;

      // Normal calculada con muestras periódicas. Los vértices de ambos bordes
      // reciben la misma pendiente y no aparece una costura de iluminación.
      vertexNormal.set(
        terrainHeight(x - normalEpsilon, z) - terrainHeight(x + normalEpsilon, z),
        normalEpsilon * 2,
        terrainHeight(x, z - normalEpsilon) - terrainHeight(x, z + normalEpsilon),
      ).normalize();
      normals[vertexOffset] = vertexNormal.x;
      normals[vertexOffset + 1] = vertexNormal.y;
      normals[vertexOffset + 2] = vertexNormal.z;

      const uAngle = (xIndex / xSegments) * Math.PI * 2;
      const vAngle = (zIndex / zSegments) * Math.PI * 2;
      const shade = THREE.MathUtils.clamp(
        0.43 + y * 0.26 + Math.sin(uAngle * 3 + vAngle * 2) * 0.055,
        0,
        1,
      );
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
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const surfaceTextures = createMarsSurfaceTextures(renderer);
  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: surfaceTextures.albedo,
    bumpMap: surfaceTextures.bump,
    bumpScale: 0.045,
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });

  // Una sola malla instanciada dibuja copias alrededor del mapa. Al cruzar un
  // borde, la cámara encuentra delante la misma superficie del lado opuesto.
  const visualTileCount = (VISUAL_TILE_RADIUS * 2 + 1) ** 2;
  const terrainTiles = new THREE.InstancedMesh(geometry, terrainMaterial, visualTileCount);
  const tileMatrix = new THREE.Matrix4();
  let tileIndex = 0;
  for (let tileZ = -VISUAL_TILE_RADIUS; tileZ <= VISUAL_TILE_RADIUS; tileZ += 1) {
    for (let tileX = -VISUAL_TILE_RADIUS; tileX <= VISUAL_TILE_RADIUS; tileX += 1) {
      tileMatrix.makeTranslation(tileX * width, 0, tileZ * depth);
      terrainTiles.setMatrixAt(tileIndex, tileMatrix);
      tileIndex += 1;
    }
  }
  terrainTiles.instanceMatrix.needsUpdate = true;
  terrainTiles.receiveShadow = true;
  terrainTiles.frustumCulled = false;
  scene.add(terrainTiles);

  // Los colliders de las ocho copias vecinas sostienen las ruedas mientras el
  // centro del rover atraviesa la costura. Después el chasis reaparece en la
  // baldosa central conservando todas sus velocidades.
  const terrainBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (let tileZ = -PHYSICS_TILE_RADIUS; tileZ <= PHYSICS_TILE_RADIUS; tileZ += 1) {
    for (let tileX = -PHYSICS_TILE_RADIUS; tileX <= PHYSICS_TILE_RADIUS; tileX += 1) {
      const collider = RAPIER.ColliderDesc.trimesh(vertices, indices);
      collider.setTranslation(tileX * width, 0, tileZ * depth);
      collider.setFriction(1.22);
      collider.setRestitution(0);
      world.createCollider(collider, terrainBody);
    }
  }
}
