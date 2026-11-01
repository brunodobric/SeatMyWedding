import SwiftUI
import SeatingCore

/// Mladenci, kumovi i njihova pratnja: sjede za stolom mladenaca i ne broje se kao gosti.
struct PartyView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var names = Array(repeating: "", count: WeddingParty.slots.count)
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(WeddingParty.slots.indices, id: \.self) { i in
                        TextField(WeddingParty.slots[i].label, text: $names[i])
                            .textInputAutocapitalization(.words)
                    }
                } footer: {
                    Text("Redom slijeva nadesno za stolom mladenaca. Prazno polje znači da te osobe nema.")
                }
                    .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Mladenci i kumovi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Odustani") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Spremi") {
                        store.saveWeddingParty(names: names)
                        dismiss()
                    }
                }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                names = store.partyNames()
            }
        }
    }
}

/// Uvoz popisa gostiju iz teksta (jedan gost ili obitelj po retku).
struct GuestImportView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var surnameFirst = false
    @State private var surnameTouched = false
    @State private var includeExisting = false
    @State private var categoryId: String?

    private var rows: [ImportRow] { GuestImport.parse(text, surnameFirst: surnameFirst) }

    private var preview: ImportPreview {
        GuestImport.preview(rows, existingNames: store.guests.compactMap { $0.string("name") }, includeExisting: includeExisting)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 180)
                        .font(Theme.ui(16))
                        .autocorrectionDisabled()
                        .onChange(of: text) { _, new in
                            if !surnameTouched { surnameFirst = GuestImport.detectSurnameFirst(new) }
                        }
                } header: {
                    Text("Zalijepi popis")
                } footer: {
                    Text("Jedan redak po gostu. „Ana i Marko Horvat” ili „Ivo, Mia, Lea Kovač” sjede zajedno, „Petar Marić +1” dodaje pratnju, a „Ana Horvat;Prijatelji” određuje kategoriju.")
                }
                    .listRowBackground(Theme.surface)
                Section {
                    Toggle("Prezime je prvo", isOn: Binding(get: { surnameFirst }, set: { surnameFirst = $0; surnameTouched = true }))
                    Picker("Kategorija", selection: $categoryId) {
                        Text("Bez kategorije").tag(String?.none)
                        ForEach(store.categories, id: \.id) { Text($0.string("name") ?? "").tag($0.id) }
                    }
                    Toggle("Uvezi i imena koja već postoje", isOn: $includeExisting)
                }
                    .listRowBackground(Theme.surface)
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Section("Pregled") {
                        Text("Dodat će se \(preview.guests) gostiju" + (preview.groups > 0 ? ", \(preview.groups) skupina sjedi zajedno" : "") + ".")
                        if preview.skipped > 0 {
                            Text("Preskočeno \(preview.skipped) (već su na popisu).").foregroundStyle(.secondary)
                        }
                    }
                        .listRowBackground(Theme.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Uvoz gostiju")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Odustani") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Dodaj") {
                        store.importGuests(rows, defaultCategoryId: categoryId, includeExisting: includeExisting)
                        dismiss()
                    }
                    .disabled(preview.guests == 0)
                }
            }
        }
    }
}
