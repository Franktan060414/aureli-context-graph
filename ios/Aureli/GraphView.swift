import SwiftUI
import AureliCore

/// The iOS layout is independent of browser-local canvas coordinates.
struct GraphView: View {
    let workspace: Workspace
    @State private var zoom = 1.0
    @GestureState private var pinch = 1.0
    @ScaledMetric(relativeTo: .body) private var cardHeight = 160
    private var scale: Double { min(2, max(0.5, zoom * pinch)) }
    private var layout: GraphLayout { GraphLayout(workspace: workspace) }
    private let cardWidth = 240.0
    private var rowHeight: Double { max(160, cardHeight) + 48 }
    var body: some View {
        if workspace.tiles.isEmpty {
            ContentUnavailableView("图谱还是空的", systemImage: "point.3.connected.trianglepath.dotted", description: Text("新增问答或便签后，节点关系会显示在这里。"))
        } else {
            VStack(spacing: 0) {
                ViewThatFits {
                    HStack { Text("双指缩放 · 滑动浏览").font(.caption).foregroundStyle(.secondary); Spacer(); controls }
                    controls
                }.padding(.horizontal)
                ScrollView([.horizontal, .vertical]) {
                    let width = Double(layout.columns) * 300 + 48
                    let height = Double(layout.rows) * rowHeight + 48
                    ZStack(alignment: .topLeading) {
                        Canvas { context, _ in
                            for edge in workspace.edges {
                                guard let source = layout.positions[edge.sourceTileId], let target = layout.positions[edge.targetTileId] else { continue }
                                let a = center(source), b = center(target)
                                var path = Path()
                                path.move(to: a)
                                path.addLine(to: b)
                                context.stroke(path, with: .color(.secondary), style: StrokeStyle(lineWidth: 1.5, dash: edge.direction == "UNDIRECTED" ? [6, 4] : []))
                                if edge.direction != "UNDIRECTED" {
                                    let angle = atan2(b.y - a.y, b.x - a.x)
                                    let tip = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
                                    var arrow = Path()
                                    arrow.move(to: CGPoint(x: tip.x - 10 * cos(angle - 0.5), y: tip.y - 10 * sin(angle - 0.5)))
                                    arrow.addLine(to: tip)
                                    arrow.addLine(to: CGPoint(x: tip.x - 10 * cos(angle + 0.5), y: tip.y - 10 * sin(angle + 0.5)))
                                    context.stroke(arrow, with: .color(.secondary), lineWidth: 1.5)
                                }
                            }
                        }.accessibilityHidden(true)
                        ForEach(workspace.tiles) { tile in
                            if let position = layout.positions[tile.id] {
                                NavigationLink(value: tile.id) {
                                    TileRow(tile: tile)
                                        .frame(width: cardWidth - 32, height: max(160, cardHeight) - 32, alignment: .topLeading)
                                        .padding(16)
                                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.tint, lineWidth: 1.5))
                                }.buttonStyle(.plain).position(center(position))
                                    .accessibilityLabel("\(tile.typeName)：\(tile.heading)，点击阅读")
                            }
                        }
                    }.frame(width: width, height: height)
                        .scaleEffect(scale, anchor: .topLeading)
                        .frame(width: width * scale, height: height * scale, alignment: .topLeading)
                }
                .background(Color(uiColor: .systemGroupedBackground))
                .simultaneousGesture(MagnifyGesture().updating($pinch) { value, state, _ in state = value.magnification }
                    .onEnded { zoom = min(2, max(0.5, zoom * $0.magnification)) })
            }
        }
    }
    private var controls: some View {
        HStack(spacing: 8) {
            Button { zoom = max(0.5, zoom - 0.25) } label: { Image(systemName: "minus.magnifyingglass").frame(width: 44, height: 44) }.accessibilityLabel("缩小图谱")
            Button("\(Int(zoom * 100))%") { zoom = 1 }.frame(minWidth: 64, minHeight: 44).accessibilityLabel("重置图谱缩放")
            Button { zoom = min(2, zoom + 0.25) } label: { Image(systemName: "plus.magnifyingglass").frame(width: 44, height: 44) }.accessibilityLabel("放大图谱")
        }
    }
    private func center(_ position: GraphPosition) -> CGPoint {
        CGPoint(x: 24 + Double(position.column) * 300 + cardWidth / 2,
                y: 24 + Double(position.row) * rowHeight + max(160, cardHeight) / 2)
    }
}
