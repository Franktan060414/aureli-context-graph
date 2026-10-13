import Foundation

public struct ContextMap: Decodable, Identifiable, Sendable {
    public let mapId: String
    public let name: String
    public var id: String { mapId }
}

public struct Tile: Decodable, Identifiable, Sendable {
    public let id: String
    public let message: String?
    public let answer: String?
    public let relatedTileIds: [String]?
    public let weight: Int?
    public let tileType: String?
    public let title: String?
    public let content: String?
    public let fileName: String?
    public let sourceUrl: String?
    public var heading: String { title.flatMap { $0.isEmpty ? nil : $0 } ?? message ?? "未命名节点" }
    public var body: String { tileType == "QA" || tileType == nil ? answer ?? "" : content ?? answer ?? "" }
    public var typeName: String {
        switch tileType {
        case "NOTE": "便签"
        case "FILE": "附件"
        case "WEB": "网页"
        default: "问答"
        }
    }
    public var symbol: String {
        switch tileType {
        case "NOTE": "note.text"
        case "FILE": "doc"
        case "WEB": "globe"
        default: "bubble.left.and.bubble.right"
        }
    }
}

public struct TileEdge: Decodable, Identifiable, Sendable {
    public let id: String
    public let sourceTileId: String
    public let targetTileId: String
    public let direction: String?
    public let relationType: String?
}

public struct Workspace: Decodable, Sendable {
    public let tiles: [Tile]
    public let edges: [TileEdge]
    public init(tiles: [Tile] = [], edges: [TileEdge] = []) { self.tiles = tiles; self.edges = edges }
}

public struct Question: Encodable, Sendable {
    public let mapId: String
    public let tileId: String
    public let message: String
    public let relatedTileIds: [String]
    public let memoryDepth: Int
    public let edgeDirection = "DIRECTED"
    public let edgeWeight = 1.0
    public init(mapId: String, tileId: String, message: String, relatedTileIds: [String], memoryDepth: Int) {
        self.mapId = mapId; self.tileId = tileId; self.message = message
        self.relatedTileIds = relatedTileIds; self.memoryDepth = memoryDepth
    }
}

public enum ServiceError: LocalizedError, Equatable {
    case invalidAddress, insecureAddress, invalidResponse, missingData, interruptedStream, oversizedEvent
    case rejected(String)
    public var errorDescription: String? {
        switch self {
        case .invalidAddress: "请输入完整的服务地址，例如 http://192.168.1.23:18082；地址中不能包含账号、查询参数或片段。"
        case .insecureAddress: "正式版本需要使用 HTTPS 服务地址。"
        case .invalidResponse: "服务返回了无法识别的内容，请检查地址是否指向 Aureli 后端。"
        case .missingData: "服务没有返回所需数据，请同步后重试。"
        case .interruptedStream: "连接已中断，尚未确认回答保存。请先同步图谱，确认结果后再提问。"
        case .oversizedEvent: "回答分片过大，已停止接收。请同步图谱后重试。"
        case .rejected(let message): message
        }
    }
}

public struct ServiceAddress: Sendable {
    public let url: URL
    public init(_ text: String, allowsHTTP: Bool) throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: trimmed),
              let host = parts.host, !host.isEmpty,
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              let url = parts.url else { throw ServiceError.invalidAddress }
        guard allowsHTTP || scheme == "https" else { throw ServiceError.insecureAddress }
        self.url = url
    }
}
