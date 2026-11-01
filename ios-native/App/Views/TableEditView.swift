import SwiftUI
import SeatingCore

/// Dodavanje i uređivanje stola: oblik, broj mjesta, okretanje.
struct TableEditView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let tableId: String?
    @State private var form = WeddingStore.TableForm(name: "", shape: "round")
    @State private var loaded = false
    @State private var confirmDelete = false

    private var existing: Record? { store.tables.first { $0.id == tableId } }
    private var isHead: Bool { existing?.string("shape") == "head" }
    private var hasHead: Bool { store.tables.contains { $0.string("shape") == "head" } }

    private var shapes: [(String, String)] {
        var all = [("round", "Okrugli"), ("square", "Kvadratni"), ("rectangular", "Pravokutni"), ("royal", "Kraljevski")]
        if !hasHead { all.append(("head", "Mladenaca")) }
        return all
    }

    private var total: Int {
        switch form.shape {
        case "round": return form.seats
        case "square": return form.seatsLong * 4
        case "head": return form.seatsLong + form.seatsEnd * 2
        default: return form.seatsLong * 2 + form.seatsEnd * 2
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Naziv stola", text: $form.name)
                    if !isHead {
                        Picker("Oblik", selection: $form.shape) {
                            ForEach(shapes, id: \.0) { Text($0.1).tag($0.0) }
                        }
                    }
                }
                Section {
                    switch form.shape {
                    case "round":
                        Stepper("Mjesta: \(form.seats)", value: $form.seats, in: 1...30)
                    case "square":
                        Stepper("Mjesta po strani: \(form.seatsLong)", value: $form.seatsLong, in: 1...12)
                    case "head":
                        Stepper("Mjesta (prednja strana): \(form.seatsLong)", value: $form.seatsLong, in: 0...24)
                        Stepper("Mjesta po čelu: \(form.seatsEnd)", value: $form.seatsEnd, in: 0...4)
                    default:
                        Stepper("Mjesta po dužoj strani: \(form.seatsLong)", value: $form.seatsLong, in: 1...20)
                        Stepper("Mjesta po čelu: \(form.seatsEnd)", value: $form.seatsEnd, in: 0...4)
                    }
                    if form.shape != "round" && form.shape != "square" {
                        Toggle("Okrenut okomito", isOn: $form.rotated)
                    }
                } footer: {
                    Text("Ukupno: \(total) mjesta")
                }
                if tableId != nil && !isHead {
                    Section {
                        Button("Obriši stol", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(tableId == nil ? "Dodaj stol" : "Uredi stol")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Odustani") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Spremi") {
                        store.saveTable(form, id: tableId)
                        dismiss()
                    }
                }
            }
            .confirmationDialog("Obrisati stol?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Obriši", role: .destructive) {
                    if let id = tableId { store.deleteTable(id) }
                    dismiss()
                }
            } message: {
                Text("Gosti za ovim stolom ostaju bez mjesta.")
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let t = existing else {
            form.name = "Stol \(store.tables.count + 1)"
            return
        }
        form.name = t.string("name") ?? ""
        form.shape = t.string("shape") ?? "round"
        let seats = (t.number("seats") ?? 8).safeInt
        form.seats = seats
        form.seatsLong = (t.integer("seatsLong") ?? Double(form.shape == "square" ? max(1, seats / 4) : 4)).safeInt
        form.seatsEnd = (t.integer("seatsEnd") ?? (form.shape == "head" ? 0 : 1)).safeInt
        form.rotated = (t.number("rotation") ?? 0) != 0
    }
}

/// "Složi salu": predložak, broj gostiju i mjesta po stolu.
struct HallSetupView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var template: HallTemplate = .round
    @State private var guestCount = 100
    @State private var perTable = 8
    @State private var mode: HallMode = .rebuild
    @State private var loaded = false

    private var hasRegular: Bool { store.tables.contains { $0.string("shape") != "head" } }

    private var plan: HallPlan {
        store.planHall(template: template, guestCount: guestCount, perTable: max(2, perTable), mode: mode)
    }

    private var summary: String {
        let p = plan
        let seats = p.create.filter { $0.string("shape") != "head" }.reduce(0) { $0 + ($1.number("seats") ?? 0).safeInt }
        if mode == .add && p.count == 0 { return "Već imate dovoljno mjesta za \(guestCount) gostiju." }
        let word = p.count == 1 ? "stol" : (p.count < 5 ? "stola" : "stolova")
        let verb = mode == .add ? "Dodat će se" : "Trebate"
        let head = p.create.contains { $0.string("shape") == "head" } ? " i stol mladenaca" : ""
        return "\(verb) \(p.count) \(word) po \(p.perTable) mjesta (\(seats) mjesta)\(head)."
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Raspored stolova") {
                    ForEach(HallTemplate.allCases, id: \.self) { t in
                        Button {
                            template = t
                            perTable = t.defaultSeats
                        } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(t.name).font(Theme.uiBold(16)).foregroundStyle(Theme.ink)
                                    Text(t.hint).font(Theme.ui(13)).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                if t == template { Image(systemName: "checkmark").foregroundStyle(Theme.gold) }
                            }
                        }
                    }
                }
                Section {
                    Stepper("Gostiju: \(guestCount)", value: $guestCount, in: 0...1000, step: 5)
                    Stepper("Mjesta po stolu: \(perTable)", value: $perTable, in: 2...30)
                    if hasRegular {
                        Picker("Što napraviti", selection: $mode) {
                            Text("Dodaj samo potrebne stolove").tag(HallMode.add)
                            Text("Složi sve ispočetka").tag(HallMode.rebuild)
                        }
                    }
                } footer: {
                    Text(summary)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Složi salu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Odustani") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Složi") {
                        store.applyHallPlan(plan)
                        dismiss()
                    }
                    .disabled(plan.count == 0 && plan.create.isEmpty)
                }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                template = store.currentTemplate()
                let regular = store.tables.filter { $0.string("shape") != "head" }
                guestCount = max(5, store.data.capacityInfo().guests)
                perTable = regular.first.map { ($0.number("seats") ?? 8).safeInt } ?? template.defaultSeats
                mode = regular.isEmpty ? .rebuild : .add
            }
        }
    }
}
