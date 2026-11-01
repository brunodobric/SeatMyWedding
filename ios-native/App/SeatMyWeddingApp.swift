import SwiftUI

@main
struct SeatMyWeddingApp: App {
    @State private var store = WeddingStore()
    @AppStorage("appearance") private var appearance = AppearanceChoice.system

    init() {
        // Traka koristi zadani iOS izgled: naša neprozirna traka skrivala je veliki naslov.
        ExportFiles.cleanUp()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.goldDeep)
                .preferredColorScheme(appearance.scheme)
        }
    }
}
