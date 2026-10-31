import SwiftUI
import SeatingCore

/// Dodavanje i uređivanje gosta (kartica gosta). Pravila "zajedno / odvojeno /
/// fiksno mjesto" dolaze s tlocrtom, u idućoj fazi.
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

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ime i prezime", text: $name)
                        .font(Theme.ui(17))
                    Picker("Kategorija", selection: $categoryId) {
                        Text("Bez kategorije").tag(String?.none)
                        ForEach(store.categories, id: \.id) { cat in
                            Text(cat.string("name") ?? "").tag(cat.id)
                        }
                    }
                }
                Section {
                    Toggle("Još nije potvrđeno (možda)", isOn: $maybe)
                    Toggle("Zaključaj mjesto", isOn: $locked)
                }
                Section("Bilješka") {
                    TextField("Npr. alergije, dječja stolica", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
                if guestId != nil {
                    Section {
                        Button("Obriši gosta", role: .destructive) { confirmDelete = true }
                    }
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
                        store.saveGuest(id: guestId, name: name, categoryId: categoryId, notes: notes, locked: locked, maybe: maybe)
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
    }
}
