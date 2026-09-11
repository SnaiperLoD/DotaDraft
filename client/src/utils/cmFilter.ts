/** Valve pick-screen type-to-filter: empty query matches everyone, grid does not reflow. */
export function heroMatchesFilter(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q);
}
