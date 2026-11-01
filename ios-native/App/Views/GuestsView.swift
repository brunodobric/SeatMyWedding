import SwiftUI
import UniformTypeIdentifiers
import SeatingCore

struct GuestsView: View {
    @Environment(WeddingStore.self) private var store
    @State private var search = ""
    @State private var categoryFilter: String?
    @State private var editing: GuestSheet?
    @State private var importing = false
    @State private var pasting = false
    @State private var party = false
    @State private var message: String?
    @State private var pendingBackup: Data?

    private var shownGuests: [Record] {
        var list = store.invitedGuests
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty {
            list = list.filter { ($0.string("name") ?? "").localizedCaseInsensitiveContains(q) }
        }
        if let c = categoryFilter {
            list = list.filter { $0.string("categoryId") == c }
        }
        return list.sorted {
            ($0.string("name") ?? "").localizedCaseInsensitiveCompare($1.string("name") ?? "") == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if store.invitedGuests.isEmpty {
                    ContentUnavailableView {
                        Label("Još nema gostiju", systemImage: "person.2")
                    } description: {
                        Text("Dodaj prvog gosta ili uvezi sigurnosnu kopiju s web aplikacije.")
                    } actions: {
                        Button("Dodaj gosta") { editing = GuestSheet(id: nil) }
                            .buttonStyle(.borderedProminent)
                        Button("Uvezi popis (tekst)") { pasting = true }
                        Button("Mladenci i kumovi") { party = true }
                        Button("Uvezi kopiju") { importing = true }
                    }
                } else {
                    List {
                        if !store.categories.isEmpty {
                            categoryChips
                                .listRowInsets(EdgeInsets())
                                .listRowBackground(Color.clear)
                        }
                        if shownGuests.isEmpty {
                            Text("Nema gostiju koji odgovaraju filtru.")
                                .font(Theme.ui(15))
                                .foregroundStyle(Theme.muted)
                        }
                        ForEach(shownGuests, id: \.id) { guest in
                            Button { editing = GuestSheet(id: guest.id) } label: { GuestRow(guest: guest) }
                                .buttonStyle(.plain)
                                .swipeActions {
                                    Button("Obriši", role: .destructive) {
                                        if let id = guest.id { store.deleteGuest(id) }
                                    }
                                }
                        }
                    }
                    .listStyle(.plain)
                    .searchable(text: $search, prompt: "Traži goste")
                }
            }
            .background(Theme.background)
            .navigationTitle("Gosti")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Dodaj gosta", systemImage: "plus") { editing = GuestSheet(id: nil) }
                        Button("Uvezi popis (tekst)", systemImage: "text.badge.plus") { pasting = true }
                        Button("Mladenci i kumovi", systemImage: "heart") { party = true }
                        Button("Uvezi kopiju", systemImage: "square.and.arrow.down") { importing = true }
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(item: $editing) { sheet in
                GuestEditView(guestId: sheet.id)
            }
            .sheet(isPresented: $pasting) { GuestImportView() }
            .sheet(isPresented: $party) { PartyView() }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                handleImport(result)
            }
            .confirmationDialog("Vratiti podatke iz kopije?", isPresented: Binding(
                get: { pendingBackup != nil }, set: { if !$0 { pendingBackup = nil } }
            ), titleVisibility: .visible) {
                Button("Zamijeni sve podatke", role: .destructive) { applyBackup() }
            } message: {
                Text("Uvoz zamjenjuje sve trenutne goste, stolove i pravila. Možeš ga poništiti.")
            }
            .alert("Uvoz", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("U redu", role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
        }
    }

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(title: "Svi", color: Theme.goldDeep, selected: categoryFilter == nil) { categoryFilter = nil }
                ForEach(store.categories, id: \.id) { cat in
                    chip(title: cat.string("name") ?? "", color: Color(cssHex: cat.string("color")),
                         selected: categoryFilter == cat.id) {
                        categoryFilter = categoryFilter == cat.id ? nil : cat.id
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    private func chip(title: String, color: Color, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(Theme.ui(14))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundStyle(selected ? Color.white : Theme.ink)
                .background(selected ? color : Theme.champagne, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func handleImport(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let bytes = try Data(contentsOf: url)
            if store.guests.isEmpty && store.tables.isEmpty {
                pendingBackup = bytes
                applyBackup()
            } else {
                pendingBackup = bytes
            }
        } catch {
            message = "Datoteka se ne može uvesti."
        }
    }

    private func applyBackup() {
        guard let bytes = pendingBackup else { return }
        pendingBackup = nil
        do {
            try store.importBackup(bytes)
        } catch {
            message = "Datoteka se ne može uvesti."
        }
    }
}

struct GuestSheet: Identifiable {
    let id: String?
}

private struct GuestRow: View {
    @Environment(WeddingStore.self) private var store
    let guest: Record

    var body: some View {
        let cat = store.category(guest.string("categoryId"))
        let maybe = guest.string("status") == "maybe"
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(guest.string("name") ?? "")
                    .font(Theme.ui(17))
                    .foregroundStyle(Theme.ink)
                Text(maybe ? "Možda" : (store.tableName(guest.string("tableId")) ?? "bez mjesta"))
                    .font(Theme.ui(13))
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
            if guest.isTruthy("locked") {
                Image(systemName: "lock.fill").font(.footnote).foregroundStyle(Theme.muted)
            }
            if let cat = cat {
                Text(cat.string("name") ?? "")
                    .font(Theme.ui(12))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .foregroundStyle(.white)
                    .background(Color(cssHex: cat.string("color")), in: Capsule())
            }
        }
        .contentShape(Rectangle())
    }
}
