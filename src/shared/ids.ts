export function uid(prefix = "id"): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${r}`;
}
