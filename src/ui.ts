import { TURBO_TARGET_SPEED_KMH } from "./config";

// El botón turbo se inserta entre los controles de cámara y reinicio para
// mantener index.html centrado en la estructura permanente de la interfaz.
const turboButton = (() => {
  const existing = document.querySelector<HTMLButtonElement>("#turbo-button");
  if (existing) return existing;

  const button = document.createElement("button");
  button.id = "turbo-button";
  button.className = "panel-button secondary";
  button.type = "button";
  button.textContent = `TURBO ${TURBO_TARGET_SPEED_KMH} KM/H: APAGADO`;
  button.title = "Acelera automáticamente hacia delante hasta 18 km/h";
  button.setAttribute("aria-pressed", "false");
  document.querySelector<HTMLButtonElement>("#reset-button")?.before(button);
  return button;
})();

export const ui = {
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
  turboButton,
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
