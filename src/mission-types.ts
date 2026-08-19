export type Waypoint = { id: string; label: string; x: number; z: number };

export type MissionBlock =
  | { id: string; type: "drive"; distance: number }
  | { id: string; type: "turn"; angle: number }
  | { id: string; type: "waypoint"; waypointId: string };

export type DriveCommand = { throttle: number; steer: number; brake: number };
