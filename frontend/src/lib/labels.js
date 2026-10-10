export function labelForTile(tile, labels = []) {
  return tile?.labelId == null ? null : labels.find(label => String(label.id) === String(tile.labelId)) || null;
}
export function labelStyle(label) {
  if (!/^#[0-9a-f]{6}$/i.test(label?.colorHex || "")) return {};
  const rgb = label.colorHex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const foreground = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#FFFFFF";
  return { "--tile-label-bg": label.colorHex, "--tile-label-fg": foreground };
}
export function commonLabelId(tiles) {
  if (!tiles.length) return "";
  const first = tiles[0].labelId == null ? "" : String(tiles[0].labelId);
  return tiles.every(tile => (tile.labelId == null ? "" : String(tile.labelId)) === first) ? first : "mixed";
}
