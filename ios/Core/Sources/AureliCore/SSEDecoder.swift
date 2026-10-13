import Foundation

/// Preserve empty lines and decode UTF-8 only after a complete SSE line arrives.
public struct SSEDecoder: Sendable {
    private var line: [UInt8] = []
    private var dataLines: [String] = []
    private var wasCR = false
    private var eventSize = 0
    public private(set) var isComplete = false
    public init() {}

    public mutating func receive(_ byte: UInt8) throws -> String? {
        if byte == 10 && wasCR { wasCR = false; return nil }
        wasCR = byte == 13
        if byte == 10 || byte == 13 { return try finishLine() }
        eventSize += 1
        guard eventSize <= 1_048_576 else { throw ServiceError.oversizedEvent }
        line.append(byte)
        return nil
    }

    public mutating func finish() throws -> String? {
        if !line.isEmpty { _ = try finishLine() }
        let text = try dispatch()
        guard isComplete else { throw ServiceError.interruptedStream }
        return text
    }

    private mutating func finishLine() throws -> String? {
        guard let text = String(bytes: line, encoding: .utf8) else { throw ServiceError.invalidResponse }
        line.removeAll(keepingCapacity: true)
        if text.isEmpty { return try dispatch() }
        if text.hasPrefix("data:") {
            var value = String(text.dropFirst(5))
            if value.first == " " { value.removeFirst() }
            dataLines.append(value)
        }
        return nil
    }

    private mutating func dispatch() throws -> String? {
        defer { dataLines.removeAll(keepingCapacity: true); eventSize = 0 }
        guard !dataLines.isEmpty, !isComplete else { return nil }
        let data = dataLines.joined(separator: "\n")
        if data == "[DONE]" { isComplete = true; return nil }
        struct Event: Decodable { let v: String?; let done: Bool?; let error: String?; let success: Bool?; let message: String? }
        guard let event = try? JSONDecoder().decode(Event.self, from: Data(data.utf8)) else { throw ServiceError.invalidResponse }
        if let error = event.error { throw ServiceError.rejected(error) }
        if event.success == false { throw ServiceError.rejected(event.message ?? "回答生成失败，请重试。") }
        if event.done == true { isComplete = true }
        return event.v
    }
}
