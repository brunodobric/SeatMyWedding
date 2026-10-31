import SwiftUI

@main
struct SeatMyWeddingApp: App {
    @State private var store = WeddingStore()

    init() {
        Theme.applyAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.goldDeep)
        }
    }
}
