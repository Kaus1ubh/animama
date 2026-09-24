/** Position Hands beside Bones only when the right inspector also fits. */
export function handPanelLayout(
  stageWidth: number,
  viewportWidth: number,
  inset: number,
) {
  const margin = viewportWidth >= 1280 ? 32 : 16;
  const bones = viewportWidth >= 1536 ? 340 : viewportWidth >= 1280 ? 288 : 248;
  const inspector =
    viewportWidth >= 1536 ? 308 : viewportWidth >= 1280 ? 296 : 248;
  const beside = inset + margin + bones + 12;
  const adjacent = beside + 280 + 12 <= stageWidth - margin - inspector;
  return { adjacent, left: adjacent ? beside : inset + margin };
}
