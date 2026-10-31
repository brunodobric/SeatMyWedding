import SwiftUI

@main
struct SeatMyWeddingApp: App {
    @State private var store = WeddingStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.goldDeep)
        }
    }
}
