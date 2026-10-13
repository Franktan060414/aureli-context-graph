// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "AureliCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "AureliCore", targets: ["AureliCore"])],
    targets: [.target(name: "AureliCore"), .testTarget(name: "AureliCoreTests", dependencies: ["AureliCore"])]
)
