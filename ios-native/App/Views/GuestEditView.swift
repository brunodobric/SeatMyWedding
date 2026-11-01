import SwiftUI
import SeatingCore

/// Dodavanje i uređivanje gosta (kartica gosta), uključujući pravila: sjedi
/// zajedno s, odvojeno od, fiksni stol i mjesto, te cijela kategorija za jedan stol.
struct GuestEditView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let guestId: String?
    @State private var name = ""
    @State private var categoryId: String?
    @State private var notes = ""
    @State private var locked = false
    @State private var maybe = false
    @State private var loaded = false
    @State private var confirmDelete = false
    @State private var together: [String] = []
    @State private var apart: [String] = []
    @State private var fixedTableId: String?
    @State private var fixedSeat: Int?
    /// Izmjena prekidača "cijela kategorija za isti stol"; nil dok je korisnik nije dirao.
    @State private var categoryTogetherEdit: Bool?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ime i prezime", text: $name)
                        .textInputAutocapitalization(.words)
                        .font(Theme.ui(17))
                    Picker("Kategorija", selection: $categoryId) {
                        Text("Bez kategorije").tag(String?.none)
                        ForEach(store.categories, id: \.id) { cat in
                            Text(cat.string("name") ?? "").tag(cat.id)
                        }
                    }
                }
                    .listRowBackground(Theme.surface)
                Section {
                    Toggle("Još nije potvrđeno (možda)", isOn: $maybe)
                    Toggle("Zaključaj mjesto", isOn: $locked)
                }
                    .listRowBackground(Theme.surface)
                Section {
                    GuestMultiPicker(title: "Sjedi zajedno s", selection: $together, exclude: guestId)
                    GuestMultiPicker(title: "Odvojeno od", selection: $apart, exclude: guestId)
                    Picker("Fiksni stol", selection: Binding(
                        get: { fixedTableId },
                        set: { fixedTableId = $0; fixedSeat = nil })) {
                        Text("Bez ograničenja").tag(String?.none)
                        ForEach(store.tables, id: \.id) { t in Text(t.string("name") ?? "Stol").tag(t.id) }
                    }
                    if let tid = fixedTableId, let table = store.tables.first(where: { $0.id == tid }) {
                        Picker("Mjesto", selection: $fixedSeat) {
                            Text("Bilo koje").tag(Int?.none)
                            ForEach(0..<FloorGeometry.count(table.number("seats")), id: \.self) { Text("\($0 + 1)").tag(Int?.some($0)) }
                        }
                    }
                    if categoryId != nil {
                        Toggle("Cijela kategorija za isti stol", isOn: Binding(
                            get: { categoryTogetherEdit ?? (categoryId.map { store.isCategoryTogether($0) } ?? false) },
                            set: { categoryTogetherEdit = $0 }))
                    }
                } header: {
                    Text("Pravila")
                } footer: {
                    Text("Automatsko slaganje pazi na ova pravila.")
                }
                    .listRowBackground(Theme.surface)
                Section("Bilješka") {
                    TextField("Npr. alergije, dječja stolica", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
                    .listRowBackground(Theme.surface)
                if guestId != nil {
                    Section {
                        Button("Obriši gosta", role: .destructive) { confirmDelete = true }
                    }
                        .listRowBackground(Theme.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(guestId == nil ? "Dodaj gosta" : "Uredi gosta")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Odustani") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Spremi") {
                        let id = store.saveGuest(id: guestId, name: name, categoryId: categoryId, notes: notes, locked: locked, maybe: maybe)
                        store.setRelations(guestId: id, together: together, apart: apart, fixedTableId: fixedTableId, fixedSeat: fixedSeat)
                        if let cat = categoryId, let on = categoryTogetherEdit, store.isCategoryTogether(cat) != on {
                            store.setCategoryTogether(cat, on: on)
                        }
                        dismiss()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .confirmationDialog("Obrisati gosta?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Obriši", role: .destructive) {
                    if let id = guestId { store.deleteGuest(id) }
                    dismiss()
                }
            }
            .onChange(of: categoryId) { _, _ in categoryTogetherEdit = nil }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let id = guestId, let g = store.guests.first(where: { $0.id == id }) else { return }
        name = g.string("name") ?? ""
        categoryId = g.string("categoryId")
        notes = g.string("notes") ?? ""
        locked = g.isTruthy("locked")
        maybe = g.string("status") == "maybe"
        let rel = store.relations(for: id)
        together = rel.together
        apart = rel.apart
        fixedTableId = rel.fixed?.string("tableId")
        fixedSeat = rel.fixed?.integer("seatIndex")?.safeInt
    }
}

/// Odabir više gostiju za pravilo.
struct GuestMultiPicker: View {
    @Environment(WeddingStore.self) private var store
    let title: String
    @Binding var selection: [String]
    let exclude: String?

    private var candidates: [Record] {
        GuestSort.name.sorted(store.invitedGuests.filter { $0.id != exclude })
    }

    private var summary: String {
        let names = selection.compactMap { id in store.guests.first { $0.id == id }?.string("name") }
        return names.isEmpty ? "Nitko" : names.joined(separator: ", ")
    }

    var body: some View {
        NavigationLink {
            List(candidates, id: \.id) { g in
                Button {
                    guard let id = g.id else { return }
                    if let i = selection.firstIndex(of: id) { selection.remove(at: i) } else { selection.append(id) }
                } label: {
                    HStack {
                        Text(g.string("name") ?? "").foregroundStyle(Theme.ink)
                        Spacer()
                        if let id = g.id, selection.contains(id) {
                            Image(systemName: "checkmark").foregroundStyle(Theme.gold)
                        }
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        } label: {
            HStack {
                Text(title)
                Spacer()
                Text(summary).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}
