import SwiftUI
import UniformTypeIdentifiers
import SeatingCore

struct GuestsView: View {
    @Environment(WeddingStore.self) private var store
    @State private var importing = false
    @State private var message: String?

    private var sortedGuests: [Record] {
        store.guests.sorted { ($0.string("name") ?? "").localizedCaseInsensitiveCompare($1.string("name") ?? "") == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            Group {
                if store.guests.isEmpty {
                    ContentUnavailableView {
                        Label("Još nema gostiju", systemImage: "person.2")
                    } description: {
                        Text("Uvezi sigurnosnu kopiju s web aplikacije (JSON).")
                    } actions: {
                        Button("Uvezi kopiju") { importing = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    List(sortedGuests, id: \.id) { guest in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(guest.string("name") ?? "")
                                .foregroundStyle(Theme.ink)
                            Text(store.tableName(guest.string("tableId")) ?? "bez mjesta")
                                .font(.footnote)
                                .foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle("Gosti")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Uvezi kopiju", systemImage: "square.and.arrow.down") { importing = true }
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                handleImport(result)
            }
            .alert("Uvoz", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("U redu", role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
        }
    }

    private func handleImport(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            try store.importBackup(try Data(contentsOf: url))
            message = "Uvezeno: \(store.guests.count) gostiju, \(store.tables.count) stolova."
        } catch {
            message = "Datoteka se ne može uvesti."
        }
    }
}
