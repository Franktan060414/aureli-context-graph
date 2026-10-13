import Foundation

public struct APIClient: Sendable {
    private let address: ServiceAddress
    private let session: URLSession
    public init(address: ServiceAddress, session: URLSession = .shared) { self.address = address; self.session = session }

    public func maps() async throws -> [ContextMap] {
        try await value(request("maps"))
    }
    public func workspace(mapId: String) async throws -> Workspace {
        try await value(request("tile/workspace", mapId: mapId))
    }
    public func createMap(name: String) async throws -> ContextMap {
        struct Body: Encodable { let name: String }
        return try await value(post("maps", body: Body(name: name)))
    }
    public func saveNote(mapId: String, tileId: String, title: String, content: String, relatedTileIds: [String], updating: Bool) async throws -> Tile {
        struct Body: Encodable { let mapId: String; let tileId: String; let title: String; let content: String; let relatedTileIds: [String] }
        return try await value(post(updating ? "tile/note/update" : "tile/note",
                                  body: Body(mapId: mapId, tileId: tileId, title: title, content: content, relatedTileIds: relatedTileIds)))
    }

    public func answer(_ question: Question, onText: @MainActor (String) -> Void) async throws -> String {
        var request = try post("chat/tile/completion", body: question)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 180
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 180
        config.timeoutIntervalForResource = 300
        let streamSession = URLSession(configuration: config)
        defer { streamSession.invalidateAndCancel() }
        let (bytes, response) = try await streamSession.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw ServiceError.invalidResponse }
        guard (200..<300).contains(http.statusCode),
              http.value(forHTTPHeaderField: "Content-Type")?.lowercased().contains("text/event-stream") == true else {
            var body = Data()
            for try await byte in bytes {
                try Task.checkCancellation()
                body.append(byte)
                if body.count >= 65_536 { break }
            }
            throw Self.responseError(body, status: http.statusCode)
        }
        var decoder = SSEDecoder()
        var answer = ""
        for try await byte in bytes {
            try Task.checkCancellation()
            if let text = try decoder.receive(byte) {
                answer += text
                await onText(answer)
            }
            if decoder.isComplete { break }
        }
        if let text = try decoder.finish() { answer += text; await onText(answer) }
        guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ServiceError.rejected("服务没有返回回答内容，请检查模型配置。") }
        return answer
    }

    public func request(_ path: String, mapId: String? = nil) throws -> URLRequest {
        let url = address.url.appending(path: "customer-service/" + path)
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { throw ServiceError.invalidAddress }
        if let mapId { parts.queryItems = [URLQueryItem(name: "mapId", value: mapId)] }
        guard let finalURL = parts.url else { throw ServiceError.invalidAddress }
        return URLRequest(url: finalURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    }

    private func post<T: Encodable>(_ path: String, body: T) throws -> URLRequest {
        var request = try request(path)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }
    private struct Envelope<T: Decodable>: Decodable { let success: Bool; let message: String?; let data: T? }
    private func value<T: Decodable & Sendable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw ServiceError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw Self.responseError(data, status: http.statusCode) }
        guard let envelope = try? JSONDecoder().decode(Envelope<T>.self, from: data) else { throw ServiceError.invalidResponse }
        guard envelope.success else { throw ServiceError.rejected(envelope.message ?? "操作失败，请重试。") }
        guard let value = envelope.data else { throw ServiceError.missingData }
        return value
    }
    private static func responseError(_ data: Data, status: Int) -> ServiceError {
        struct Failure: Decodable { let message: String?; let error: String? }
        let failure = try? JSONDecoder().decode(Failure.self, from: data)
        return .rejected(failure?.message ?? failure?.error ?? "服务请求失败（\(status)），请检查服务地址和后端日志。")
    }
}
