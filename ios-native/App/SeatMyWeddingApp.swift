import SwiftUI

@main
struct SeatMyWeddingApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store: WeddingStore
    @State private var cloud: CloudSync
    @AppStorage("appearance") private var appearance = AppearanceChoice.system
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Traka koristi zadani iOS izgled: naša neprozirna traka skrivala je veliki naslov.
        ExportFiles.cleanUp()
        let store = WeddingStore()
        let cloud = CloudSync(store: store)
        _store = State(initialValue: store)
        _cloud = State(initialValue: cloud)
        AppDelegate.onRemoteChange = { cloud.syncNow() }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(cloud)
                .tint(Theme.goldDeep)
                .preferredColorScheme(appearance.scheme)
        }
        // Pri pokretanju i svakom povratku u aplikaciju pokupi promjene s drugih uređaja.
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { cloud.syncNow() }
        }
    }
}
