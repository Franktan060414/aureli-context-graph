import Foundation

public struct GraphPosition: Sendable { public let column: Int; public let row: Int }
public struct GraphLayout: Sendable {
    public let positions: [String: GraphPosition]
    public let columns: Int
    public let rows: Int
    public init(workspace: Workspace) {
        let ids = Set(workspace.tiles.map(\.id))
        var parents: [String: Set<String>] = [:]
        for edge in workspace.edges where ids.contains(edge.sourceTileId) && ids.contains(edge.targetTileId) && edge.direction != "UNDIRECTED" {
            parents[edge.targetTileId, default: []].insert(edge.sourceTileId)
        }
        var levels: [String: Int] = [:]
        var remaining = workspace.tiles.map(\.id)
        while !remaining.isEmpty {
            let ready = remaining.filter { (parents[$0] ?? []).allSatisfy { levels[$0] != nil } }
            // Cycles have no topological order. Place one node, then continue deterministically.
            let batch = ready.isEmpty ? Array(remaining.prefix(1)) : ready
            for id in batch {
                levels[id] = min(12, (parents[id] ?? []).compactMap { levels[$0].map { $0 + 1 } }.max() ?? 0)
            }
            let placed = Set(batch)
            remaining.removeAll { placed.contains($0) }
        }
        var counts: [Int: Int] = [:]
        var result: [String: GraphPosition] = [:]
        for tile in workspace.tiles {
            let column = levels[tile.id] ?? 0
            let row = counts[column, default: 0]
            result[tile.id] = GraphPosition(column: column, row: row)
            counts[column] = row + 1
        }
        positions = result
        columns = max(1, (levels.values.max() ?? 0) + 1)
        rows = max(1, counts.values.max() ?? 0)
    }
}
