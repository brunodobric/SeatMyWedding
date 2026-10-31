import SwiftUI
import SeatingCore

struct SeatingView: View {
    @Environment(WeddingStore.self) private var store

    private var seated: Int {
        store.guests.filter { !($0.string("tableId") ?? "").isEmpty }.count
    }

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Raspored", systemImage: "list.bullet.rectangle")
            } description: {
                Text("Smješteno: \(seated) od \(store.guests.count) gostiju. Raspored dolazi u sljedećoj fazi.")
            }
            .background(Theme.background)
            .navigationTitle("Raspored")
        }
    }
}
