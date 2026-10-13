import Foundation
import Observation
import AureliCore

@Observable
final class WorkspaceStore {
    private(set) var maps: [ContextMap] = []
    private(set) var workspace = Workspace()
    private(set) var selectedMap: ContextMap?
    private(set) var serviceURL = UserDefaults.standard.string(forKey: "aureli.serviceURL") ?? ""
    private(set) var isLoading = false
    var isAnswering = false
    var errorMessage: String?
    @ObservationIgnored private(set) var api: APIClient?
    @ObservationIgnored private var revision = UUID()

    func connect(to text: String) async throws {
        guard !isLoading, !isAnswering else { throw ServiceError.rejected("正在执行其他操作，请稍后重试。") }
        let address = try ServiceAddress(text, allowsHTTP: Self.allowsHTTP)
        let candidate = APIClient(address: address)
        isLoading = true
        defer { isLoading = false }
        let maps = try await candidate.maps()
        let selected = maps.first { $0.id == UserDefaults.standard.string(forKey: "aureli.selectedMap") } ?? maps.first
        let snapshot: Workspace
        if let selected { snapshot = try await candidate.workspace(mapId: selected.id) }
        else { snapshot = Workspace() }
        try Task.checkCancellation()
        revision = UUID()
        self.api = candidate
        self.maps = maps
        self.selectedMap = selected
        self.workspace = snapshot
        serviceURL = address.url.absoluteString
        UserDefaults.standard.set(serviceURL, forKey: "aureli.serviceURL")
        UserDefaults.standard.set(selected?.id, forKey: "aureli.selectedMap")
    }

    func restoreConnection() async {
        guard api == nil, !serviceURL.isEmpty else { return }
        do { try await connect(to: serviceURL) }
        catch is CancellationError { }
        catch { errorMessage = error.localizedDescription }
    }

    func select(_ map: ContextMap) async {
        guard let api, !isLoading, !isAnswering else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let snapshot = try await api.workspace(mapId: map.id)
            try Task.checkCancellation()
            revision = UUID()
            selectedMap = map
            workspace = snapshot
            UserDefaults.standard.set(map.id, forKey: "aureli.selectedMap")
        } catch is CancellationError { }
        catch { errorMessage = error.localizedDescription }
    }

    func refresh() async {
        guard let api, let selectedMap else { return }
        revision = UUID()
        let token = revision
        do {
            let snapshot = try await api.workspace(mapId: selectedMap.id)
            guard token == revision else { return }
            workspace = snapshot
        } catch is CancellationError { }
        catch { if token == revision { errorMessage = error.localizedDescription } }
    }

    func createMap(name: String) async throws {
        guard let api, !isLoading, !isAnswering else { throw ServiceError.rejected("服务尚未连接或正在执行其他操作，请稍后重试。") }
        isLoading = true
        defer { isLoading = false }
        let map = try await api.createMap(name: name)
        // The create response is already committed; update the local list immediately.
        revision = UUID()
        maps.append(map)
        selectedMap = map
        workspace = Workspace()
        UserDefaults.standard.set(map.id, forKey: "aureli.selectedMap")
    }

    func saveNote(tile: Tile?, title: String, content: String, parents: [String]) async throws {
        guard let api, let selectedMap, !isLoading, !isAnswering else { throw ServiceError.rejected("请先连接服务并选择图谱，或等待当前操作完成。") }
        isLoading = true
        revision = UUID()
        defer { isLoading = false }
        let node = try await api.saveNote(mapId: selectedMap.id, tileId: tile?.id ?? "note-\(UUID())",
                                          title: title, content: content, relatedTileIds: parents, updating: tile != nil)
        var nodes = workspace.tiles.filter { $0.id != node.id }
        nodes.append(node)
        workspace = Workspace(tiles: nodes, edges: workspace.edges)
        await refresh()
    }

    private static var allowsHTTP: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
}
