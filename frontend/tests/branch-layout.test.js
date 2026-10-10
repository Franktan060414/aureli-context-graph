import test from "node:test";
import assert from "node:assert/strict";
import { branchColumnFractions, branchRowPresentation, branchRows } from "../src/lib/branch-layout.js";

const tile = (id, relatedTileIds = []) => ({ id, relatedTileIds });
const ids = rows => rows.map(row => row.tiles.map(tile => tile.id));

test("unordered branches keep one depth row and include each Tile once", () => {
  const tiles = [tile("leaf", ["left"]), tile("root"), tile("left", ["root"]), tile("right", ["root"]), tile("other", ["right"])];
  assert.deepEqual(ids(branchRows(tiles)), [["root"], ["left", "right"], ["leaf", "other"]]);
});

test("a shared descendant follows its deepest parent without duplication", () => {
  const tiles = [tile("merged", ["a", "deep"]), tile("a"), tile("b"), tile("deep", ["b"])];
  assert.deepEqual(ids(branchRows(tiles)), [["a", "b"], ["deep"], ["merged"]]);
});

test("directed edges supply ancestry, peer edges and missing endpoints do not", () => {
  const edges = [
    { sourceTileId: "a", targetTileId: "b", direction: "DIRECTED", relationType: "DIVIDES" },
    { sourceTileId: "b", targetTileId: "c", direction: "UNDIRECTED", relationType: "RELATES" },
    { sourceTileId: "missing", targetTileId: "a", direction: "DIRECTED" },
  ];
  assert.deepEqual(ids(branchRows([tile("b"), tile("c"), tile("a")], edges)), [["c", "a"], ["b"]]);
});

test("cycles, dangling references, and self references cannot hide Tiles", () => {
  const tiles = [tile("a", ["b", "a"]), tile("b", ["a"]), tile("c", ["missing"])];
  const rows = branchRows(tiles);
  assert.equal(rows.flatMap(row => row.tiles).length, 3);
  assert.equal(new Set(rows.flatMap(row => row.tiles.map(tile => tile.id))).size, 3);
  assert.deepEqual(branchRows([]), []);
});

test("canvas weights and positions never affect conversation rows", () => {
  const tiles = [tile("a"), tile("b", ["a"]), tile("c", ["a"])];
  const changed = tiles.map((tile, index) => ({ ...tile, weight: index + 1, x: index * 500, y: -100 }));
  assert.deepEqual(ids(branchRows(changed)), ids(branchRows(tiles)));
});

test("longer content gets more width without letting short siblings disappear", () => {
  const tiles = [
    { id: "short", message: "简短问题", answer: "一个结论。" },
    { id: "long", message: "深入分析", answer: "更详细的推导与解释。".repeat(100) },
    { id: "middle", message: "比较", answer: "补充分析。".repeat(12) },
  ];
  const shares = branchColumnFractions(tiles, 1200);
  assert.ok(shares[1] > shares[2] && shares[2] > shares[0]);
  assert.ok(shares.every(share => Number.isFinite(share) && share * 1200 >= 180));
  assert.ok(Math.abs(shares.reduce((sum, share) => sum + share, 0) - 1) < 1e-10);
});

test("empty content, one Tile, and narrow rows always stay within their row", () => {
  assert.deepEqual(branchColumnFractions([]), []);
  assert.deepEqual(branchColumnFractions([{}], 375), [1]);
  const equal = branchColumnFractions([{}, {}, {}], 1200);
  assert.ok(equal.every(share => Math.abs(share - 1 / 3) < 1e-10));
  const narrow = branchColumnFractions(Array.from({ length: 8 }, (_, index) => ({ answer: "内容".repeat(index * 30) })), 375);
  assert.ok(narrow.every(share => Math.abs(share - 1 / 8) < 1e-10));
});

test("note and file bodies count toward width, Markdown link URLs do not", () => {
  const tiles = [
    { message: "附件", tileType: "FILE", content: "正文".repeat(100) },
    { message: "便签", tileType: "NOTE", content: "备注".repeat(30) },
    { message: "问答", answer: "[参考](https://example.com/" + "hidden-path".repeat(100) + ")" },
  ];
  const shares = branchColumnFractions(tiles, 1200);
  assert.ok(shares[0] > shares[1] && shares[1] > shares[2]);
});

test("content growth updates widths while canvas weight changes leave them unchanged", () => {
  const tiles = [{ message: "Q", answer: "A" }, { message: "Q", answer: "A" }];
  const initial = branchColumnFractions(tiles, 1200);
  tiles[1].answer = "增长的回答".repeat(100);
  const grown = branchColumnFractions(tiles, 1200);
  assert.ok(grown[1] > initial[1]);
  assert.deepEqual(branchColumnFractions(tiles.map(tile => ({ ...tile, weight: 3, x: 500 })), 1200), grown);
});

test("collapsed siblings move left, keep source order, and release width to visible answers", () => {
  const tiles = [tile("a"), tile("b"), tile("c")];
  const shown = branchRowPresentation(tiles, ["c", "b"], 1200);
  assert.deepEqual(shown.tiles.map(tile => tile.id), ["b", "c", "a"]);
  assert.deepEqual(shown.collapsedIds, ["b", "c"]);
  assert.equal(shown.expandedCount, 1);
  assert.equal(shown.columns, "64px 64px minmax(0, 1fr)");
  assert.deepEqual(branchRowPresentation(tiles, ["c"], 1200).tiles.map(tile => tile.id), ["c", "a", "b"]);
  assert.deepEqual(tiles.map(tile => tile.id), ["a", "b", "c"]);
});

test("deleted or regrouped answers cannot leave a row entirely collapsed", () => {
  const shown = branchRowPresentation([tile("a"), tile("b")], ["missing", "a", "b"], 375);
  assert.equal(shown.expandedCount, 1);
  assert.deepEqual(shown.collapsedIds, ["b"]);
  assert.deepEqual(branchRowPresentation([tile("a")], ["a"]).collapsedIds, []);
  assert.equal(branchRowPresentation([], ["a"]).columns, "");
});

test("phone collapse rails keep touch targets and let the last answer use remaining width", () => {
  const shown = branchRowPresentation([tile("a"), tile("b"), tile("c")], ["a", "b"], 360);
  assert.equal(shown.columns, "57.6px 57.6px minmax(0, 1fr)");
  assert.ok(shown.minWidth <= 360);
  const crowded = branchRowPresentation(Array.from({ length: 12 }, (_, i) => tile(String(i))), Array.from({ length: 11 }, (_, i) => String(i)), 360);
  assert.ok(crowded.columns.startsWith("44px"));
  assert.ok(crowded.minWidth >= 11 * 44 + 120);
});
