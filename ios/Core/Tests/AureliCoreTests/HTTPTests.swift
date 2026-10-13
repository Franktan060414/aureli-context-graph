import Foundation
import Testing
@testable import AureliCore

private func fixtureAPI() throws -> APIClient {
    let url = try #require(ProcessInfo.processInfo.environment["AURELI_IOS_FIXTURE_URL"])
    return APIClient(address: try ServiceAddress(url, allowsHTTP: true))
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["AURELI_IOS_FIXTURE_URL"] != nil))
func jsonEnvelopesAndBackendFailures() async throws {
    let api = try fixtureAPI()
    let maps = try await api.maps()
    #expect(maps.first?.id == "fixture-map")
    #expect(try await api.workspace(mapId: "fixture-map").tiles.isEmpty)
    await #expect(throws: ServiceError.rejected("图谱不存在")) { try await api.workspace(mapId: "failure") }
    await #expect(throws: ServiceError.missingData) { try await api.workspace(mapId: "missing") }
    await #expect(throws: ServiceError.invalidResponse) { try await api.workspace(mapId: "html") }
    await #expect(throws: ServiceError.rejected("访问被拒绝")) { try await api.workspace(mapId: "forbidden") }
}

@MainActor
@Test(.enabled(if: ProcessInfo.processInfo.environment["AURELI_IOS_FIXTURE_URL"] != nil))
func urlSessionStreamsUTF8AndRequiresPersistence() async throws {
    let api = try fixtureAPI()
    var updates: [String] = []
    let question = Question(mapId: "fixture-map", tileId: "fixture-tile", message: "success", relatedTileIds: [], memoryDepth: 3)
    let answer = try await api.answer(question) { updates.append($0) }
    #expect(answer == "你好🙂")
    #expect(updates.last == answer)
    let interrupted = Question(mapId: "fixture-map", tileId: "fixture-tile", message: "interrupt", relatedTileIds: [], memoryDepth: 0)
    await #expect(throws: ServiceError.interruptedStream) { try await api.answer(interrupted) { _ in } }
    let failure = Question(mapId: "fixture-map", tileId: "fixture-tile", message: "failure", relatedTileIds: [], memoryDepth: 0)
    await #expect(throws: ServiceError.rejected("保存失败")) { try await api.answer(failure) { _ in } }
}
