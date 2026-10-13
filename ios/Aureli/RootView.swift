import SwiftUI
import AureliCore

struct RootView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var showsSettings = false
    @State private var showsCreate = false
    @State private var mapName = ""
    @State private var search = ""
    @State private var mode = Mode.list
    @State private var editor: Editor?
    private enum Mode: String, CaseIterable { case list = "列表", graph = "图谱" }
    private enum Editor: Identifiable {
        case question([String]), note(Tile?)
        var id: String { switch self { case .question: "question"; case .note: "note" } }
    }
    private var filteredTiles: [Tile] {
        store.workspace.tiles.filter { search.isEmpty || $0.heading.localizedStandardContains(search) || $0.body.localizedStandardContains(search) }
    }

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Group {
                if store.api == nil {
                    ContentUnavailableView {
                        Label("连接你的工作空间", systemImage: "point.3.connected.trianglepath.dotted")
                    } description: {
                        Text("连接 Mac 或服务器上的 Aureli 服务，继续阅读和整理你的图谱。")
                    } actions: {
                        Button("设置服务地址") { showsSettings = true }.buttonStyle(.borderedProminent)
                    }
                } else if store.selectedMap == nil {
                    ContentUnavailableView {
                        Label("创建第一个图谱", systemImage: "square.stack.3d.up")
                    } description: { Text("用问答和便签，把想法连接起来。") }
                    actions: { Button("新建图谱") { showsCreate = true }.buttonStyle(.borderedProminent) }
                } else {
                    VStack(spacing: 0) {
                        Picker("查看方式", selection: $mode) {
                            ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }.pickerStyle(.segmented).padding()
                        if mode == .list {
                            List(filteredTiles) { tile in
                                NavigationLink(value: tile.id) { TileRow(tile: tile) }
                            }
                            .overlay {
                                if filteredTiles.isEmpty {
                                    ContentUnavailableView(search.isEmpty ? "图谱还是空的" : "没有匹配的节点",
                                                           systemImage: search.isEmpty ? "square.stack" : "magnifyingglass",
                                                           description: Text(search.isEmpty ? "点击右上角新增问答或便签。" : "试试其他关键词。"))
                                }
                            }
                            .refreshable { await store.refresh() }
                        } else {
                            GraphView(workspace: Workspace(tiles: filteredTiles, edges: store.workspace.edges))
                        }
                    }
                    .navigationDestination(for: String.self) { id in
                        if let tile = store.workspace.tiles.first(where: { $0.id == id }) {
                            TileDetailView(tile: tile, ask: { editor = .question([tile.id]) }, edit: { editor = .note(tile) })
                        } else {
                            ContentUnavailableView("节点已更新", systemImage: "arrow.clockwise", description: Text("返回图谱并同步最新内容。"))
                        }
                    }
                    .id(store.selectedMap?.id)
                    .searchable(text: $search, prompt: "搜索节点")
                }
            }
            .navigationTitle(store.selectedMap?.name ?? "Aureli")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        ForEach(store.maps) { map in
                            Button {
                                Task { await store.select(map) }
                            } label: {
                                Label(map.name, systemImage: map.id == store.selectedMap?.id ? "checkmark" : "square.stack")
                            }
                        }
                        Divider()
                        Button("新建图谱", systemImage: "plus") { showsCreate = true }.disabled(store.api == nil)
                        Button("服务连接", systemImage: "gearshape") { showsSettings = true }
                    } label: { Label("工作空间", systemImage: "square.stack.3d.up") }
                    .disabled(store.isLoading || store.isAnswering)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("提问", systemImage: "bubble.left") { editor = .question([]) }
                        Button("便签", systemImage: "note.text") { editor = .note(nil) }
                        Button("同步图谱", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
                    } label: { Label("新增与同步", systemImage: "plus") }
                    .disabled(store.selectedMap == nil || store.isLoading || store.isAnswering)
                }
            }
            .overlay(alignment: .top) {
                if store.isLoading { ProgressView("正在连接…").padding().background(.regularMaterial, in: Capsule()).padding() }
            }
        }
        .task { await store.restoreConnection() }
        .sheet(isPresented: $showsSettings) { ConnectionView() }
        .sheet(item: $editor) { editor in
            switch editor {
            case .question(let parents): QuestionView(initialParents: parents)
            case .note(let tile): NoteEditor(tile: tile)
            }
        }
        .alert("新建图谱", isPresented: $showsCreate) {
            TextField("图谱名称", text: $mapName)
            Button("取消", role: .cancel) { mapName = "" }
            Button("创建") {
                let name = mapName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty, name.count <= 100 else { store.errorMessage = "图谱名称应为 1 至 100 个字符。"; return }
                Task {
                    do { try await store.createMap(name: name); mapName = "" }
                    catch { store.errorMessage = error.localizedDescription }
                }
            }
        }
        .alert("暂时无法完成", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
            Button("知道了", role: .cancel) { store.errorMessage = nil }
        } message: { Text(store.errorMessage ?? "") }
    }
}

struct TileRow: View {
    let tile: Tile
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(tile.typeName, systemImage: tile.symbol).font(.caption).foregroundStyle(.secondary)
            Text(tile.heading).font(.headline).lineLimit(3)
            if !tile.body.isEmpty { Text(tile.body).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
            if (tile.weight ?? 1) > 1 { Label("重要节点", systemImage: "star.fill").font(.caption).foregroundStyle(.secondary) }
        }.padding(.vertical, 8)
    }
}

struct MarkdownText: View {
    let text: String
    var body: some View {
        Text((try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text))
            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TileDetailView: View {
    @Environment(WorkspaceStore.self) private var store
    let tile: Tile
    let ask: () -> Void
    let edit: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Label(tile.typeName, systemImage: tile.symbol).font(.subheadline).foregroundStyle(.secondary)
                Text(tile.heading).font(.title2.bold()).textSelection(.enabled)
                if let source = tile.sourceUrl, let url = URL(string: source), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                    Link("打开来源网页", destination: url).frame(minHeight: 44)
                }
                MarkdownText(text: tile.body.isEmpty ? "此节点暂时没有可阅读的正文。" : tile.body)
                let parents = store.workspace.tiles.filter { tile.relatedTileIds?.contains($0.id) == true }
                if !parents.isEmpty {
                    Divider()
                    Text("上下文来源").font(.headline)
                    ForEach(parents) { parent in
                        NavigationLink(value: parent.id) { Label(parent.heading, systemImage: parent.symbol).frame(minHeight: 44) }
                    }
                }
                if tile.tileType == "FILE" {
                    Text("当前显示服务端提取的文字；原附件预览和下载将在后续版本接入。").font(.footnote).foregroundStyle(.secondary)
                }
            }.padding(24).frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
        }
        .navigationTitle("节点阅读").navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Button("关联提问", systemImage: "bubble.left") { ask() }.buttonStyle(.borderedProminent)
                if tile.tileType == "NOTE" { Button("编辑便签", systemImage: "pencil") { edit() }.buttonStyle(.bordered) }
            }.frame(maxWidth: .infinity).padding().background(.bar)
                .disabled(store.isLoading || store.isAnswering)
        }
    }
}
