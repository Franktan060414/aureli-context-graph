export function relationTypeForDirection(direction) {
  return direction?.trim().toUpperCase() === "UNDIRECTED" ? "RELATES" : "EXTENDS";
}

export function relationTypeForEdge(edge) {
  if (["DEVIDES", "DIVIEDS"].includes(edge.relationType)) return "DIVIDES";
  return ["FUSES", "DIVIDES"].includes(edge.relationType) ? edge.relationType : relationTypeForDirection(edge.direction);
}
