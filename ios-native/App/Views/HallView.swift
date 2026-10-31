import SwiftUI

struct HallView: View {
    @Environment(WeddingStore.self) private var store

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("Sala", systemImage: "square.grid.3x3")
            } description: {
                Text("Stolova: \(store.tables.count). Tlocrt dolazi u sljedećoj fazi.")
            }
            .background(Theme.background)
            .navigationTitle("Sala")
        }
    }
}
