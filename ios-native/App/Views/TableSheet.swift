import SwiftUI
import SeatingCore

struct TableRef: Identifiable {
    let id: String
}

/// Tko sjedi za stolom: popis mjesta. Dodir na slobodno mjesto nudi goste bez
/// mjesta, dodir na zauzeto nudi uklanjanje ili zaključavanje.
struct TableSheet: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let tableId: String
    @State private var pickingSeat: SeatRef?
    @State private var actionsFor: Record?
    @State private var editing = false

    private struct SeatRef: Identifiable { let id: Int }

    private var table: Record? { store.tables.first { $0.id == tableId } }

    private var seatCount: Int { FloorGeometry.count(table?.number("seats")) }

    private func occupant(_ seat: Int) -> Record? {
        store.guests.first { $0.string("tableId") == tableId && $0.integer("seatIndex") == Double(seat) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(0..<seatCount, id: \.self) { seat in
                    Button {
                        if let g = occupant(seat) { actionsFor = g } else { pickingSeat = SeatRef(id: seat) }
                    } label: {
                        HStack {
                            Text("\(seat + 1)")
                                .font(Theme.uiBold(13))
                                .frame(width: 26, height: 26)
                                .foregroundStyle(.white)
                                .background(HallView.seatColor(occupant(seat)) ?? Theme.border, in: Circle())
                            if let g = occupant(seat) {
                                Text(g.string("name") ?? "")
                                    .font(Theme.ui(17)).foregroundStyle(Theme.ink)
                                Spacer()
                                if g.isTruthy("locked") {
                                    Image(systemName: "lock.fill").font(.footnote).foregroundStyle(Theme.muted)
                                }
                            } else {
                                Text("slobodno")
                                    .font(Theme.ui(17)).foregroundStyle(Theme.muted)
                                Spacer()
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.plain)
            .background(Theme.background)
            .navigationTitle(table?.string("name") ?? "Stol")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Uredi stol") { editing = true } }
                ToolbarItem(placement: .confirmationAction) { Button("Gotovo") { dismiss() } }
            }
            .sheet(isPresented: $editing) { TableEditView(tableId: tableId) }
            .onChange(of: table == nil) { _, gone in if gone { dismiss() } }
            .sheet(item: $pickingSeat) { seat in
                GuestPicker { guestId in
                    store.drop(guestId, onto: .seat(tableId: tableId, seatIndex: seat.id))
                }
            }
            .confirmationDialog(actionsFor?.string("name") ?? "", isPresented: Binding(
                get: { actionsFor != nil }, set: { if !$0 { actionsFor = nil } }
            ), titleVisibility: .visible) {
                if let g = actionsFor, let id = g.id {
                    Button("Makni s mjesta") { store.drop(id, onto: .unseat) }
                    Button(g.isTruthy("locked") ? "Otključaj mjesto" : "Zaključaj mjesto") {
                        store.setLocked(id, !g.isTruthy("locked"))
                    }
                }
            }
        }
    }
}

/// Izbor gosta bez mjesta (s pretragom).
struct GuestPicker: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    let onPick: (String) -> Void

    private var shown: [Record] {
        let all = store.unseatedGuests()
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return all }
        return all.filter { ($0.string("name") ?? "").localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                if shown.isEmpty {
                    Text("Nema gostiju bez mjesta.")
                        .font(Theme.ui(15)).foregroundStyle(Theme.muted)
                }
                ForEach(shown, id: \.id) { g in
                    Button {
                        if let id = g.id { onPick(id) }
                        dismiss()
                    } label: {
                        HStack {
                            Text(g.string("name") ?? "").font(Theme.ui(17)).foregroundStyle(Theme.ink)
                            Spacer()
                            if let cat = store.category(g.string("categoryId")) {
                                Text(cat.string("name") ?? "")
                                    .font(Theme.ui(12))
                                    .padding(.horizontal, 10).padding(.vertical, 4)
                                    .foregroundStyle(.white)
                                    .background(Color(cssHex: cat.string("color")), in: Capsule())
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .listStyle(.plain)
            .searchable(text: $search, prompt: "Traži goste")
            .navigationTitle("Tko sjedi ovdje?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Odustani") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
