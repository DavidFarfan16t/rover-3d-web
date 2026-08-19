export const MODEL_URL = `${import.meta.env.BASE_URL}models/rover_web_optimizado_v3.glb`;
export const PHYSICS_HZ = 120;
export const FIXED_STEP = 1 / PHYSICS_HZ;
export const MAX_FRAME_DELTA = 0.08;
export const MAX_SUBSTEPS = 10;
export const WHEEL_RADIUS = 0.182;
export const SUSPENSION_REST = 0.23;
export const START = { x: 0, y: 0.62, z: 4.2 };
export const TERRAIN = { width: 28, depth: 44, centerZ: -5 };
export const TERRAIN_X_MIN = -TERRAIN.width / 2;
export const TERRAIN_X_MAX = TERRAIN.width / 2;
export const TERRAIN_Z_MIN = TERRAIN.centerZ - TERRAIN.depth / 2;
export const TERRAIN_Z_MAX = TERRAIN.centerZ + TERRAIN.depth / 2;
export const VISUAL_TILE_RADIUS = 2;
export const PHYSICS_TILE_RADIUS = 1;
export const MAX_INDEPENDENT_ROCKER_ANGLE = 0.52;
export const MAX_DIFFERENTIAL_ANGLE = 0.35;
export const MAX_VISUAL_ROLL = 0.40;
export const NORMAL_MAX_DRIVE_SPEED = 2.5;
export const TURBO_TARGET_SPEED_KMH = 18;
export const TURBO_MAX_DRIVE_SPEED = TURBO_TARGET_SPEED_KMH / 3.6;

// Tren motriz: cuatro motores de 2,6 N·m, cada uno con reducción 50:1.
// Rapier recibe fuerza longitudinal por rueda, por eso convertimos el par
// disponible mediante F = torque / radio. El valor ideal se limita después
// por el agarre, porque aplicar los 586 N teóricos por rueda haría patinar o
// volcar un rover de aproximadamente 45,6 kg.
export const MOTOR_COUNT = 4;
export const MOTOR_TORQUE_NM = 2.6;
export const GEAR_RATIO = 50;
export const DRIVETRAIN_EFFICIENCY = 0.82;
export const ROVER_MASS_KG = 45.6;
export const TIRE_TRACTION_COEFFICIENT = 1.1;
export const WHEEL_TORQUE_NM = MOTOR_TORQUE_NM * GEAR_RATIO * DRIVETRAIN_EFFICIENCY;
export const THEORETICAL_WHEEL_FORCE_N = WHEEL_TORQUE_NM / WHEEL_RADIUS;
export const TRACTION_LIMIT_PER_WHEEL_N = ROVER_MASS_KG * 9.81 * TIRE_TRACTION_COEFFICIENT / MOTOR_COUNT;
export const CRUISE_ENGINE_FORCE = 78;
export const CLIMB_ENGINE_FORCE = Math.min(THEORETICAL_WHEEL_FORCE_N, TRACTION_LIMIT_PER_WHEEL_N);
export const AUTOPILOT_MAX_THROTTLE = 0.88;
export const THROTTLE_RISE_RATE = 1.8;
export const THROTTLE_FALL_RATE = 2.2;
export const TRACTION_ASSIST_RISE_RATE = 2.5;
export const TRACTION_ASSIST_FALL_RATE = 2.5;
export const ANTI_WHEELIE_RISE_RATE = 7.0;
export const ANTI_WHEELIE_FALL_RATE = 2.2;
export const ANTI_WHEELIE_MIN_TORQUE_SCALE = 0.18;
export const CONTACT_RECOVERY_FORCE_PER_WHEEL = 36;
export const AUTOPILOT_BRAKE = 0.9;
export const MANUAL_BRAKE = 0.65;
export const WAYPOINT_PASS_RADIUS = 0.58;

// Apariencia del cielo marciano. Puedes cambiar estos colores CSS si quieres
// una atmósfera más clara, rojiza u oscura.
export const MARS_SKY_COLORS = {
  zenith: "#754052",
  horizon: "#e49a6d",
  ground: "#74311f",
  sun: "#ffd2a6",
};
