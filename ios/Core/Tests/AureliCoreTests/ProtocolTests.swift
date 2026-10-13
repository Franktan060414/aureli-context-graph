import Foundation
import Testing
@testable import AureliCore

private func parse(_ input: String) throws -> (String, Bool) {
    var parser = SSEDecoder()
    var output = ""
    for byte in input.utf8 { if let text = try parser.receive(byte) { output += text } }
    if let text = try parser.finish() { output += text }
    return (output, parser.isComplete)
}

@Test(arguments: ["\n", "\r\n", "\r"])
func streamingChineseAndTerminalEvent(newline: String) throws {
    let input = ": heartbeat\(newline)\(newline)data: {\"v\":\"你好🙂\"}\(newline)\(newline)data: {\"v\":\"世界\"}\(newline)\(newline)data: {\"done\":true}\(newline)\(newline)"
    let (text, done) = try parse(input)
    #expect(text == "你好🙂世界")
    #expect(done)
}

@Test func splitUTF8AndMultilineData() throws {
    let (text, done) = try parse("data: {\n" + "data: \"v\": \"上下文\"}\n\n" + "data: {\"done\":true}")
    #expect(text == "上下文")
    #expect(done)
}

@Test func missingSaveConfirmationIsFailure() {
    #expect(throws: ServiceError.interruptedStream) { try parse("data: {\"v\":\"已显示的内容\"}\n\n") }
}

@Test func serverFailureOverridesPartialAnswer() {
    #expect(throws: ServiceError.rejected("保存失败")) {
        try parse("data: {\"v\":\"部分内容\"}\n\ndata: {\"error\":\"保存失败\"}\n\n")
    }
}

@Test func malformedEventIsRejected() {
    #expect(throws: ServiceError.invalidResponse) { try parse("data: <html>error</html>\n\n") }
}

@Test func terminalDoneMarker() throws {
    #expect(try parse("data: {\"v\":\"OK\"}\n\ndata: [DONE]\n\n").0 == "OK")
}

@Test func eventSizeIsBounded() {
    #expect(throws: ServiceError.oversizedEvent) {
        var parser = SSEDecoder()
        for _ in 0...1_048_576 { _ = try parser.receive(65) }
    }
}

@Test(arguments: ["file:///etc/passwd", "http://", "http://user:secret@host", "https://host?a=1", "https://host#fragment", "host:18081"])
func invalidAddressesAreRejected(address: String) {
    #expect(throws: ServiceError.invalidAddress) { try ServiceAddress(address, allowsHTTP: true) }
}

@Test func releaseRequiresHTTPS() {
    #expect(throws: ServiceError.insecureAddress) { try ServiceAddress("http://192.168.1.23:18082", allowsHTTP: false) }
}

@Test func mapQueryAndBasePathArePreserved() throws {
    let client = APIClient(address: try ServiceAddress("http://localhost:18082/aureli/", allowsHTTP: true))
    let request = try client.request("tile/workspace", mapId: "图谱 / & +")
    let url = try #require(request.url)
    let parts = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(parts.path == "/aureli/customer-service/tile/workspace")
    #expect(parts.queryItems?.first?.value == "图谱 / & +")
}

@Test func questionMatchesJavaContract() throws {
    let question = Question(mapId: "map-1", tileId: "tile-2", message: "问题", relatedTileIds: ["note-3"], memoryDepth: 3)
    let data = try JSONEncoder().encode(question)
    let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(json["mapId"] as? String == "map-1")
    #expect(json["relatedTileIds"] as? [String] == ["note-3"])
    #expect(json["edgeDirection"] as? String == "DIRECTED")
    #expect(json["memoryDepth"] as? Int == 3)
}

@Test func workspaceHandlesNullsAndUnknownFields() throws {
    let data = Data("""
    {"tiles":[{"id":"qa","message":"提问","answer":"完整回答","tileType":"QA","title":null,"weight":null},
    {"id":"note","title":"便签","tileType":"NOTE","content":"正文"},
    {"id":"web","title":"网页","tileType":"WEB","content":"快照","sourceUrl":"https://example.com","fetchStatus":"READY"}],
    "edges":[],"labels":[{"id":1}]}
    """.utf8)
    let workspace = try JSONDecoder().decode(Workspace.self, from: data)
    #expect(workspace.tiles.map(\.body) == ["完整回答", "正文", "快照"])
    #expect(workspace.tiles[0].heading == "提问")
}

@Test func graphCyclesTerminateAndEveryNodeHasAPosition() throws {
    let workspace = try JSONDecoder().decode(Workspace.self, from: Data("""
    {"tiles":[{"id":"a"},{"id":"b"},{"id":"c"}],"edges":[
    {"id":"ab","sourceTileId":"a","targetTileId":"b","direction":"DIRECTED"},
    {"id":"ba","sourceTileId":"b","targetTileId":"a","direction":"DIRECTED"},
    {"id":"bc","sourceTileId":"b","targetTileId":"c","direction":"UNDIRECTED"},
    {"id":"missing","sourceTileId":"gone","targetTileId":"c","direction":"DIRECTED"}]}
    """.utf8))
    let layout = GraphLayout(workspace: workspace)
    #expect(layout.positions.count == 3)
    #expect(layout.columns <= 13)
    #expect(layout.rows >= 1)
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["AURELI_IOS_TEST_SERVICE_URL"] != nil))
func liveBackendReadOnlyContract() async throws {
    let url = try #require(ProcessInfo.processInfo.environment["AURELI_IOS_TEST_SERVICE_URL"])
    let api = APIClient(address: try ServiceAddress(url, allowsHTTP: true))
    let maps = try await api.maps()
    for map in maps {
        let workspace = try await api.workspace(mapId: map.id)
        #expect(Set(workspace.tiles.map(\.id)).count == workspace.tiles.count)
    }
}
