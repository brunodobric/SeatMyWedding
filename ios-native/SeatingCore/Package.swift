// swift-tools-version:5.9
import PackageDescription

// SeatingCore: logika SeatMyWedding bez ikakvog sučelja (modeli, čišćenje
// podataka, sinkronizacija). Ne ovisi ni o čemu osim Foundationa pa se gradi i
// testira i na Macu i na Linuxu.
let package = Package(
    name: "SeatingCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SeatingCore", targets: ["SeatingCore"])
    ],
    targets: [
        .target(name: "SeatingCore"),
        .testTarget(
            name: "SeatingCoreTests",
            dependencies: ["SeatingCore"],
            resources: [.copy("Fixtures")]
        )
    ]
)
