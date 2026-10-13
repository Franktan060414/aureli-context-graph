import SwiftUI
import AureliCore

struct ContextPicker: View {
    let tiles: [Tile]
    @Binding var selected: Set<String>
    var body: some View {
        Section {
            ForEach(tiles) { tile in
                Button {
                    if selected.contains(tile.id) { selected.remove(tile.id) }
                    else { selected.insert(tile.id) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: selected.contains(tile.id) ? "checkmark.circle.fill" : "circle")
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(tile.heading).foregroundStyle(.primary)
                            Text(tile.typeName).font(.caption).foregroundStyle(.secondary)
                        }
                    }.frame(minHeight: 44)
                }
                .accessibilityLabel(tile.heading)
                .accessibilityValue(selected.contains(tile.id) ? "已选为上下文" : "未选择")
                .accessibilityAddTraits(selected.contains(tile.id) ? .isSelected : [])
            }
        } header: { Text("上下文来源 · 已选 \(selected.count) 个") }
        footer: { Text("未选择时独立提问；选择后，后端沿节点关系读取上下文。") }
    }
}

struct QuestionView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let initialParents: [String]
    @State private var message = ""
    @State private var parents = Set<String>()
    @State private var depth = 3
    @State private var answer = ""
    @State private var phase = Phase.draft
    @State private var error: String?
    @State private var generation: Task<Void, Never>?
    @State private var showsDiscard = false
    private enum Phase { case draft, running, saved, interrupted }
    private var isRunning: Bool { phase == .running }
    var body: some View {
        NavigationStack {
            Form {
                Section("问题") {
                    TextField("你想继续探索什么？", text: $message, axis: .vertical)
                        .lineLimit(4...12).disabled(phase != .draft).accessibilityLabel("问题正文")
                }
                if phase == .draft {
                    ContextPicker(tiles: store.workspace.tiles, selected: $parents)
                    Section {
                        Stepper("追溯深度：\(depth)", value: $depth, in: 0...6)
                    } footer: { Text("0 只读取直接选择的节点；深度越大，可能带入更多历史内容。") }
                }
                if phase != .draft {
                    Section {
                        if !answer.isEmpty { MarkdownText(text: answer) }
                        if isRunning { ProgressView("正在生成并保存…") }
                        if phase == .saved { Label("回答已保存到图谱", systemImage: "checkmark.circle.fill").foregroundStyle(.secondary) }
                        if let error { Text(error).foregroundStyle(.red) }
                        if phase == .interrupted {
                            Button("同步图谱并返回") { Task { await store.refresh(); dismiss() } }.frame(minHeight: 44)
                        }
                    } header: { Text("回答") }
                }
            }
            .navigationTitle("关联提问").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isRunning ? "停止" : "关闭") {
                        if isRunning { generation?.cancel() }
                        else if phase == .draft && !message.isEmpty { showsDiscard = true }
                        else { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if phase == .draft {
                        Button("发送") { send() }
                            .disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.api == nil || store.isLoading)
                    } else if phase == .saved { Button("完成") { dismiss() } }
                }
            }
            .onAppear { parents = Set(initialParents) }
            .onDisappear { generation?.cancel() }
            .interactiveDismissDisabled(isRunning || (phase == .draft && !message.isEmpty))
            .confirmationDialog("放弃尚未发送的问题？", isPresented: $showsDiscard, titleVisibility: .visible) {
                Button("放弃草稿", role: .destructive) { dismiss() }
            }
        }
    }
    private func send() {
        guard let api = store.api, let map = store.selectedMap, !store.isAnswering else { return }
        let question = Question(mapId: map.id, tileId: "tile-\(UUID())",
                                message: message.trimmingCharacters(in: .whitespacesAndNewlines),
                                relatedTileIds: parents.sorted(), memoryDepth: depth)
        phase = .running
        store.isAnswering = true
        generation = Task {
            defer { store.isAnswering = false; generation = nil }
            do {
                answer = try await api.answer(question) { answer = $0 }
                phase = .saved
                await store.refresh()
            } catch {
                phase = .interrupted
                self.error = (error is CancellationError || (error as? URLError)?.code == .cancelled)
                    ? "已停止接收。后端可能仍在处理，请同步图谱确认保存结果。"
                    : "\(error.localizedDescription)\n请先同步图谱，确认是否已保存后再重新提问。"
            }
        }
    }
}

struct NoteEditor: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let tile: Tile?
    @State private var title = ""
    @State private var content = ""
    @State private var parents = Set<String>()
    @State private var isSaving = false
    @State private var error: String?
    @State private var saveTask: Task<Void, Never>?
    @State private var showsDiscard = false
    private var hasChanges: Bool { title != (tile?.title ?? "") || content != (tile?.content ?? "") || parents != Set(tile?.relatedTileIds ?? []) }
    var body: some View {
        NavigationStack {
            Form {
                Section("标题") { TextField("便签标题", text: $title).accessibilityLabel("便签标题") }
                Section("正文") {
                    TextEditor(text: $content).frame(minHeight: 200).accessibilityLabel("便签正文")
                }
                ContextPicker(tiles: store.workspace.tiles.filter { $0.id != tile?.id }, selected: $parents)
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }.disabled(isSaving)
            .navigationTitle(tile == nil ? "新建便签" : "编辑便签").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { if hasChanges { showsDiscard = true } else { dismiss() } }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "保存中…" : "保存") { save() }
                        .disabled(isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { title = tile?.title ?? ""; content = tile?.content ?? ""; parents = Set(tile?.relatedTileIds ?? []) }
            .onDisappear { saveTask?.cancel() }
            .interactiveDismissDisabled(isSaving || hasChanges)
            .confirmationDialog("放弃尚未保存的便签？", isPresented: $showsDiscard, titleVisibility: .visible) {
                Button("放弃更改", role: .destructive) { dismiss() }
            }
        }
    }
    private func save() {
        guard title.count <= 255, content.count <= 100_000 else { error = "标题最多 255 个字符，正文最多 10 万个字符。"; return }
        isSaving = true
        error = nil
        saveTask = Task {
            defer { isSaving = false; saveTask = nil }
            do {
                try await store.saveNote(tile: tile, title: title.trimmingCharacters(in: .whitespacesAndNewlines), content: content, parents: parents.sorted())
                dismiss()
            } catch { self.error = "\(error.localizedDescription) 请先同步图谱确认是否已保存。" }
        }
    }
}
