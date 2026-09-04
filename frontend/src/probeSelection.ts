export function toggleProbe(selected: string[], tpId: string): string[] {
  if (selected.includes(tpId)) {
    return selected.filter((id) => id !== tpId);
  }
  if (selected.length < 2) {
    return [...selected, tpId];
  }
  return [selected[1], tpId];
}
