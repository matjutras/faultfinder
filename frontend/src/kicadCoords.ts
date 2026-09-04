// KiCad's `(paper "A4")` with no `(portrait)` modifier renders landscape
// (297mm wide x 210mm tall) -- confirmed against a real KiCanvas render, not
// assumed. `controls="none"` fits the whole page into its container
// (letterboxed, centered), so this is a plain "object-fit: contain" transform.
const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;

export function schematicMmToPixels(
  xMm: number,
  yMm: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  const scale = Math.min(containerWidth / PAGE_WIDTH_MM, containerHeight / PAGE_HEIGHT_MM);
  const offsetX = (containerWidth - PAGE_WIDTH_MM * scale) / 2;
  const offsetY = (containerHeight - PAGE_HEIGHT_MM * scale) / 2;
  return { x: offsetX + xMm * scale, y: offsetY + yMm * scale };
}
