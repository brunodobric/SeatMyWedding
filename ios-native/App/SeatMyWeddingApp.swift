import SwiftUI

@main
struct SeatMyWeddingApp: App {
    @State private var store = WeddingStore()
    @AppStorage("appearance") private var appearance = AppearanceChoice.system

    init() {
        Theme.applyAppearance()
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
