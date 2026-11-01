import SwiftUI
import SeatingCore

struct SeatingView: View {
    @Environment(WeddingStore.self) private var store
    @State private var search = ""
    @AppStorage("tableSort") private var tableSort = TableSort.number
    @State private var result: SeatingSuggestion?
    @State private var tableSheet: TableRef?

    private var unseated: [Record] {
        let q = search.trimmingCharacters(in: .whitespaces)
        return store.unseatedGuests().filter { q.isEmpty || ($0.string("name") ?? "").localizedCaseInsensitiveContains(q) }
    }

    private var seatedCount: Int {
        store.invitedGuests.filter { !($0.string("tableId") ?? "").isEmpty }.count
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Smješteno \(seatedCount) od \(store.invitedGuests.count)")
                            .font(Theme.ui(15))
                        Button {
                            if store.tables.isEmpty {
                                store.show("Najprije dodaj stolove u Sali.", isError: true)
                            } else {
                                result = store.autoSeat()
                            }
                        } label: {
                            Label("Složi automatski", systemImage: "wand.and.stars")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.roundedRectangle(radius: 10))
                        .tint(Theme.gold)
                    }
                    if store.violatedRuleCount > 0 {
                        Label("\(store.violatedRuleCount) pravila nije ispunjeno", systemImage: "exclamationmark.triangle")
                            .font(Theme.ui(14))
                            .foregroundStyle(Theme.error)
                    }
                }
                    .listRowBackground(Theme.surface)

                Section("Bez mjesta (\(unseated.count))") {
                    if unseated.isEmpty {
                        Text(search.isEmpty ? "Svi gosti imaju mjesto." : "Nema rezultata.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(unseated, id: \.id) { guest in
                        HStack {
                            if let cat = store.category(guest.string("categoryId")), let c = cat.string("color") {
                                Circle().fill(Color(cssHex: c)).frame(width: 10, height: 10)
                            }
                            Text(guest.string("name") ?? "").font(Theme.ui(16))
                            Spacer()
                            Menu {
                                ForEach(tableSort.sorted(store.tables, in: store), id: \.id) { table in
                                    Button(table.string("name") ?? "Stol") {
                                        if let gid = guest.id, let tid = table.id {
                                            store.drop(gid, onto: .table(tableId: tid))
                                        }
                                    }
                                }
                            } label: {
                                Label("Smjesti", systemImage: "chair.lounge")
                                    .labelStyle(.titleAndIcon)
                                    .font(Theme.ui(14))
                            }
                            .disabled(store.tables.isEmpty)
                        }
                    }
                }
                    .listRowBackground(Theme.surface)

                Section("Stolovi") {
                    ForEach(tableSort.sorted(store.tables, in: store), id: \.id) { table in
                        Button {
                            if let id = table.id { tableSheet = TableRef(id: id) }
                        } label: {
                            HStack {
                                Text(table.string("name") ?? "Stol").font(Theme.ui(16))
                                Spacer()
                                Text("\(occupied(table)) / \(FloorGeometry.count(table.number("seats")))")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .tint(.primary)
                    }
                }
                    .listRowBackground(Theme.surface)
            }
            .searchable(text: $search, prompt: "Traži goste bez mjesta")
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Raspored")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SortMenu(selection: $tableSort) { $0.label } }
                ToolbarItem(placement: .primaryAction) { ExportMenu() }
            }
            .sheet(item: $tableSheet) { ref in TableSheet(tableId: ref.id) }
            .sheet(item: Binding(get: { result.map(ResultBox.init) }, set: { if $0 == nil { result = nil } })) { box in
                SeatingResultView(result: box.value)
            }
        }
    }

    private func occupied(_ table: Record) -> Int {
        store.guests.filter { $0.string("tableId") == table.id }.count
    }
}

private struct ResultBox: Identifiable, Equatable {
    let value: SeatingSuggestion
    var id: String { "result" }
}

private struct SeatingResultView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let result: SeatingSuggestion

    private var placed: Int { result.assignments.filter { $0.tableId != nil }.count }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Raspoređeno \(placed)/\(result.assignments.count) gostiju.")
                    if placed < result.assignments.count {
                        Text("Za \(result.assignments.count - placed) gostiju nema dovoljno mjesta. Dodaj stolove u Sali.")
                            .foregroundStyle(.secondary)
                    }
                }
                    .listRowBackground(Theme.surface)
                Section {
                    if result.violations.isEmpty {
                        Label("Svi posebni zahtjevi su ispunjeni.", systemImage: "checkmark.circle")
                            .foregroundStyle(Theme.success)
                    } else {
                        Label("\(result.violations.count) zahtjev(a) nije moguće ispuniti:", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Theme.error)
                        ForEach(result.violations.indices, id: \.self) { Text(result.violations[$0].reason) }
                    }
                }
                    .listRowBackground(Theme.surface)
            }
            .navigationTitle("Automatsko slaganje")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Poništi") { store.undoAutoSeating(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("U redu") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
