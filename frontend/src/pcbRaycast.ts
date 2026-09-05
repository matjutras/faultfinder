// Converts a drag-drop's screen point into a board-mm coordinate for the PCB
// view, by raycasting from the real camera through the drop point against the
// board's own top plane -- the same real camera geometry three.js already
// uses for click raycasting, just driven by a drop event's clientX/clientY
// instead of a pointer event r3f dispatches itself. Deliberately takes a
// plain three.js Camera plus a plain DOMRect-shaped bounds object rather than
// reading them off `useThree()`/`getBoundingClientRect()` directly, so this
// stays testable with a real Camera and no react-three-fiber test harness.
import type { Camera } from 'three';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { HIT_TARGET_HEIGHT_M, MM_PER_M } from './kicadCoords';

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function screenToBoardMm(
  camera: Camera,
  clientX: number,
  clientY: number,
  rect: ScreenRect,
  boardThicknessMm: number,
): { xMm: number; yMm: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) {
    return null;
  }

  const ndc = new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -(((clientY - rect.top) / rect.height) * 2 - 1),
  );
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);

  // The same horizontal plane the probe hit-targets/lead indicators sit on
  // (see pcbMmToThreeVec3): board thickness plus the small hit-target
  // clearance, in glTF meters (Y is up).
  const planeY = boardThicknessMm / MM_PER_M + HIT_TARGET_HEIGHT_M;
  const plane = new Plane(new Vector3(0, 1, 0), -planeY);
  const point = new Vector3();
  if (!raycaster.ray.intersectPlane(plane, point)) return null;

  return { xMm: point.x * MM_PER_M, yMm: point.z * MM_PER_M };
}
