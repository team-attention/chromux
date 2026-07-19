// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ChromuxStatusBar",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .target(
            name: "ChromuxStatusBarCore"
        ),
        .executableTarget(
            name: "ChromuxStatusBar",
            dependencies: ["ChromuxStatusBarCore"]
        ),
        .testTarget(
            name: "ChromuxStatusBarCoreTests",
            dependencies: ["ChromuxStatusBarCore"]
        ),
    ]
)
