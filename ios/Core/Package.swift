// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "AureliCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AureliCore", targets: ["AureliCore"]),
        .executable(name: "AureliBackendHarness", targets: ["AureliBackendHarness"])
    ],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .systemLibrary(name: "CZlib"),
        .target(name: "AureliCore", dependencies: ["CSQLite", "CZlib"]),
        .executableTarget(name:"AureliBackendHarness",dependencies:["AureliCore"]),
        .testTarget(name: "AureliCoreTests", dependencies: ["AureliCore"], resources: [.copy("Fixtures")])
    ]
)
