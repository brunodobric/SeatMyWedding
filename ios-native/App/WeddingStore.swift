import Foundation
import Observation
import SeatingCore

/// Stanje aplikacije: cijelo vjenčanje i nadgrobni zapisi, spremljeni kao JSON
/// datoteka na uređaju (radi i bez prijave i bez interneta). Svaka izmjena
/// stavlja `updatedAt` i briše tako da se kasnije može spojiti s oblakom
/// (faza 5), isto kao js/db.js na webu.
@MainActor
@Observable
final class WeddingStore {
    private(set) var sync = SyncState()
    private(set) var loadError: String?
    private let fileURL: URL

    /// Kratka poruka na dnu ekrana (npr. "Ana i Ivo su zamijenili mjesta"), s gumbom Poništi.
    struct Toast: Identifiable {
        let id = UUID()
        var message: String
        var isError: Bool
        var undo: (() -> Void)?
    }
    private(set) var toast: Toast?

    func show(_ message: String, isError: Bool = false, undo: (() -> Void)? = nil) {
        let t = Toast(message: message, isError: isError, undo: undo)
        toast = t
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(6))
            if toast?.id == t.id { toast = nil }
        }
    }

    func dismissToast() { toast = nil }

    nonisolated static var defaultURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("wedding.json")
    }

    init(fileURL: URL = WeddingStore.defaultURL) {
        self.fileURL = fileURL
        load()
    }

    var data: WeddingData { sync.wedding }
    var guests: [Record] { sync.records["guests"] ?? [] }
    var tables: [Record] { sync.records["tables"] ?? [] }
    var categories: [Record] { sync.records["categories"] ?? [] }

    /// Gosti s popisa; mladenci i kumovi nisu gosti (kao na webu).
    var invitedGuests: [Record] { guests.filter { !$0.isTruthy("party") } }

    func tableName(_ id: String?) -> String? {
        guard let id = id else { return nil }
        return tables.first { $0.id == id }?.string("name")
    }

    func category(_ id: String?) -> Record? {
        guard let id = id else { return nil }
        return categories.first { $0.id == id }
    }

    private static func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    // MARK: Učitavanje i spremanje

    private func load() {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        do {
            let bytes = try Data(contentsOf: fileURL)
            sync = SyncState(json: try JSONDecoder().decode(JSONValue.self, from: bytes))
            repair()
        } catch {
            loadError = "Spremljeni podaci se ne mogu pročitati."
        }
    }

    /// Popravci nakon učitavanja, kao na webu; promijenjeni zapisi se spremaju.
    private func repair() {
        var wedding = sync.wedding
        let tableIds = Set(wedding.migrateTables())
        let guestIds = Set(wedding.repairSeating())
        if !tableIds.isEmpty {
            sync.put("tables", wedding.tables.filter { tableIds.contains($0.id ?? "") }, now: Self.now())
        }
        if !guestIds.isEmpty {
            sync.put("guests", wedding.guests.filter { guestIds.contains($0.id ?? "") }, now: Self.now())
        }
        if !tableIds.isEmpty || !guestIds.isEmpty { persist() }
    }

    /// JSON sigurnosna kopija s web aplikacije (isti oblik: settings, tables, categories, guests, rules).
    /// Zamjenjuje sve trenutne podatke, ali kao obične izmjene (obrisani zapisi dobivaju
    /// nadgrobne oznake da se brisanje prenese i u oblak) i uz mogućnost poništavanja.
    func importBackup(_ bytes: Data) throws {
        let raw = try JSONDecoder().decode(JSONValue.self, from: bytes)
        guard raw.objectValue != nil else { throw CocoaError(.fileReadCorruptFile) }
        var wedding = DataCleaning.cleanData(raw)
        wedding.migrateTables()
        wedding.repairSeating()
        let undo = commit(wedding)
        show("Podaci su vraćeni iz kopije", undo: undo)
    }

    private func persist() {
        do {
            let bytes = try JSONEncoder().encode(sync.toJSON())
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try bytes.write(to: fileURL, options: .atomic)
        } catch {
            loadError = "Podaci se ne mogu spremiti."
        }
    }

    // MARK: Izmjene

    func put(_ store: String, _ items: [Record]) {
        sync.put(store, items, now: Self.now())
        persist()
    }

    func remove(_ store: String, ids: [String]) {
        sync.remove(store, ids: ids, now: Self.now())
        persist()
    }

    // MARK: Gosti

    /// Novi gost ili izmjena postojećeg (ostala polja ostaju kakva jesu, npr.
    /// uloga mladenaca). Gost koji je "možda" gubi mjesto, kao na webu.
    @discardableResult
    func saveGuest(id: String?, name: String, categoryId: String?, notes: String, locked: Bool, maybe: Bool) -> String {
        var guest = guests.first { $0.id == id } ?? Record([
            "id": .string(UUID().uuidString.lowercased()),
            "tableId": .null,
            "seatIndex": .null
        ])
        guest["name"] = .string(name.trimmingCharacters(in: .whitespacesAndNewlines))
        guest["categoryId"] = categoryId.map { .string($0) } ?? .null
        guest["notes"] = .string(notes.trimmingCharacters(in: .whitespacesAndNewlines))
        guest["locked"] = .bool(locked)
        if maybe {
            guest["tableId"] = .null
            guest["seatIndex"] = .null
            guest["status"] = .string("maybe")
        } else {
            let seated = !(guest.string("tableId") ?? "").isEmpty
            guest["status"] = .string(seated ? "assigned" : "unassigned")
        }
        put("guests", [guest])
        return guest.id ?? ""
    }

    /// Briše gosta i izbacuje ga iz pravila (grupa "zajedno" ostaje ako u njoj ima
    /// bar dvoje; pravila "odvojeno" i "fiksno mjesto" za gosta nestaju).
    func deleteGuest(_ id: String) {
        guard let guest = guests.first(where: { $0.id == id }) else { return }
        var after = data
        after.guests.removeAll { $0.id == id }
        after.rules = after.normalizeRules(after.rules)
        let undo = commit(after)
        show("Obrisano: \(guest.string("name") ?? "gost")", undo: undo)
    }

    // MARK: Pravila

    var rules: [Record] { sync.records["rules"] ?? [] }

    /// Odnosi gosta: s kim sjedi, od koga je odvojen, fiksni stol/mjesto.
    func relations(for guestId: String) -> (together: [String], apart: [String], fixed: Record?) {
        var together: [String] = [], apart: [String] = []
        var fixed: Record?
        for r in rules {
            let ids = (r["guestIds"]?.arrayValue ?? []).compactMap { $0.stringValue }
            guard ids.contains(guestId) else { continue }
            switch r.string("type") {
            case "together", "companion": for id in ids where id != guestId && !together.contains(id) { together.append(id) }
            case "apart": for id in ids where id != guestId && !apart.contains(id) { apart.append(id) }
            case "fixed": fixed = r
            default: break
            }
        }
        return (together, apart, fixed)
    }

    func applyRules(_ next: [Record]) {
        let diff = data.diffRules(to: next)
        if !diff.changed.isEmpty { put("rules", diff.changed) }
        if !diff.removedIds.isEmpty { remove("rules", ids: diff.removedIds) }
    }

    func setRelations(guestId: String, together: [String], apart: [String], fixedTableId: String?, fixedSeat: Int?) {
        applyRules(data.rulesAfterSettingRelations(
            guestId: guestId, together: together, apart: apart,
            fixedTableId: fixedTableId, fixedSeat: fixedSeat.map(Double.init)))
    }

    func isCategoryTogether(_ id: String) -> Bool { data.isCategoryTogether(id) }

    func setCategoryTogether(_ id: String, on: Bool) {
        applyRules(data.rulesAfterSettingCategoryTogether(id, on: on))
    }

    /// Broj pravila koja trenutno nisu ispunjena.
    var violatedRuleCount: Int {
        let d = data
        return d.rules.filter { d.isSatisfied($0) == false }.count
    }

    // MARK: Smještanje

    /// Spušta gosta na mjesto, stol ili "bez mjesta" (zamjena s onim tko sjedi, bez
    /// zaključanih). Pravila su ista kao na webu (SeatingCore.dropGuest).
    func drop(_ guestId: String, onto target: DropTarget) {
        let result = data.dropGuest(guestId, onto: target)
        if let n = result.notice { show(n.message, isError: n.isError) }
        guard !result.moves.isEmpty else { return }
        let touched = Set(result.moves.map { $0.id })
        let before = guests.filter { touched.contains($0.id ?? "") }
        var wedding = data
        let changed = Set(wedding.place(result.moves))
        put("guests", wedding.guests.filter { changed.contains($0.id ?? "") })
        if let message = result.undoMessage {
            show(message, undo: { [weak self] in self?.put("guests", before) })
        }
    }

    func setLocked(_ guestId: String, _ locked: Bool) {
        guard var g = guests.first(where: { $0.id == guestId }) else { return }
        g["locked"] = .bool(locked)
        put("guests", [g])
    }

    /// Automatsko slaganje; vraća prijedlog radi prikaza. Poništava se samo ono što je
    /// slaganje promijenilo (`undoAutoSeating`).
    private var autoSeatingUndo: (() -> Void)?

    @discardableResult
    func autoSeat() -> SeatingSuggestion {
        let suggestion = data.suggestSeating()
        var after = data
        after.apply(suggestion)
        autoSeatingUndo = commit(after)
        return suggestion
    }

    func undoAutoSeating() {
        autoSeatingUndo?()
        autoSeatingUndo = nil
    }

    func unseatedGuests() -> [Record] {
        invitedGuests
            .filter { $0.string("status") != "assigned" && $0.string("status") != "maybe" }
            .sorted { ($0.string("name") ?? "").localizedCaseInsensitiveCompare($1.string("name") ?? "") == .orderedAscending }
    }

    // MARK: Stolovi

    func moveTable(_ id: String, x: Double, y: Double) {
        guard var t = tables.first(where: { $0.id == id }) else { return }
        t["x"] = .number(x.rounded())
        t["y"] = .number(y.rounded())
        put("tables", [t])
    }

    /// Oblik stola kao u obrascu za stol na webu (broj mjesta po obliku).
    struct TableForm {
        var name: String
        var shape: String
        var seats = 8
        var seatsLong = 4
        var seatsEnd = 0
        var rotated = false
    }

    func tableRecord(_ form: TableForm, existing: Record?) -> Record {
        var seats = form.seats, seatsLong: Int?, seatsEnd: Int?
        switch form.shape {
        case "round":
            seats = max(1, form.seats)
        case "square":
            seatsLong = max(1, form.seatsLong); seatsEnd = seatsLong; seats = seatsLong! * 4
        case "head":
            var sl = max(0, form.seatsLong); let se = max(0, form.seatsEnd)
            if sl + se * 2 < 1 { sl = 1 }
            seatsLong = sl; seatsEnd = se; seats = sl + se * 2
        default:
            seatsLong = max(1, form.seatsLong); seatsEnd = max(0, form.seatsEnd); seats = seatsLong! * 2 + seatsEnd! * 2
        }
        var t = existing ?? Record(["id": .string(UUID().uuidString.lowercased()), "x": .number(500), "y": .number(350)])
        let trimmed = form.name.trimmingCharacters(in: .whitespacesAndNewlines)
        t["name"] = .string(trimmed.isEmpty ? "Stol" : trimmed)
        t["shape"] = .string(form.shape)
        t["seats"] = .number(Double(seats))
        t["seatsLong"] = seatsLong.map { .number(Double($0)) }
        t["seatsEnd"] = seatsEnd.map { .number(Double($0)) }
        t["rotation"] = .number(form.shape != "round" && form.shape != "square" && form.rotated ? 90 : 0)
        return t
    }

    /// Sprema novi ili izmijenjeni stol; gosti na ukinutim mjestima dobivaju druga mjesta.
    func saveTable(_ form: TableForm, id: String?) {
        let existing = tables.first { $0.id == id }
        var table = tableRecord(form, existing: existing)
        if existing == nil { table = data.placeNewTable(table) }
        put("tables", [table])
        let moved = data.reseatOverflowGuests(table: table)
        if !moved.isEmpty { put("guests", moved) }
    }

    /// Briše stol (osim stola mladenaca): gosti ostaju bez mjesta, pravila za taj stol nestaju.
    func deleteTable(_ id: String) {
        guard let table = tables.first(where: { $0.id == id }), table.string("shape") != "head" else { return }
        let seated = guests.filter { $0.string("tableId") == id }
        let gone = rules.filter { $0.string("tableId") == id }
        let name = table.string("name") ?? "Stol"
        remove("tables", ids: [id])
        let freed = seated.map { g -> Record in
            var g = g
            g["tableId"] = .null; g["seatIndex"] = .null; g["status"] = .string("unassigned")
            return g
        }
        if !freed.isEmpty { put("guests", freed) }
        if !gone.isEmpty { remove("rules", ids: gone.compactMap { $0.id }) }
        show("Obrisano: \(name)", undo: { [weak self] in
            self?.put("tables", [table])
            if !seated.isEmpty { self?.put("guests", seated) }
            if !gone.isEmpty { self?.put("rules", gone) }
        })
    }

    func planHall(template: HallTemplate, guestCount: Int, perTable: Int, mode: HallMode) -> HallPlan {
        data.planHall(template: template, guestCount: guestCount, perTable: perTable, mode: mode)
    }

    func currentTemplate() -> HallTemplate { data.currentHallTemplateForUI() }

    /// Primjenjuje plan sale ("Složi salu") uz mogućnost poništavanja.
    func applyHallPlan(_ plan: HallPlan) {
        let removed = Set(plan.remove)
        var after = data
        after.tables.removeAll { removed.contains($0.id ?? "") }
        var freed = 0
        for i in after.guests.indices where removed.contains(after.guests[i].string("tableId") ?? "") {
            after.guests[i]["tableId"] = .null
            after.guests[i]["seatIndex"] = .null
            after.guests[i]["status"] = .string("unassigned")
            freed += 1
        }
        after.tables.append(contentsOf: plan.create)
        after.rules = after.normalizeRules(after.rules)
        let undo = commit(after)
        show(freed == 0 ? "Sala je složena" : "Sala je složena, \(freed) gostiju je bez mjesta", undo: undo)
    }

    // MARK: Zajednički zapis više promjena

    /// Zapisuje razliku između trenutnog stanja i `new` (stolovi, gosti, kategorije,
    /// pravila) i vraća funkciju koja poništava samo te zapise, ne i izmjene nastale kasnije.
    @discardableResult
    func commit(_ new: WeddingData) -> () -> Void {
        var restores: [(key: String, previous: [Record], created: [String])] = []
        func diff(_ key: String, _ next: [Record]) {
            let old = sync.records[key] ?? []
            let oldById = Dictionary(old.compactMap { r in r.id.map { ($0, r) } }, uniquingKeysWith: { $1 })
            let nextIds = Set(next.compactMap { $0.id })
            let changed = next.filter { r in r.id.flatMap { oldById[$0] } != r }
            let gone = old.compactMap { $0.id }.filter { !nextIds.contains($0) }
            let touched = Set(changed.compactMap { $0.id }).union(gone)
            let previous = old.filter { touched.contains($0.id ?? "") }
            let created = changed.compactMap { $0.id }.filter { oldById[$0] == nil }
            if !gone.isEmpty { remove(key, ids: gone) }
            if !changed.isEmpty { put(key, changed) }
            if !previous.isEmpty || !created.isEmpty { restores.append((key, previous, created)) }
        }
        diff("settings", [new.settings])
        diff("tables", new.tables)
        diff("categories", new.categories)
        diff("guests", new.guests)
        diff("rules", new.rules)
        return { [weak self] in
            guard let self else { return }
            for r in restores {
                if !r.created.isEmpty { self.remove(r.key, ids: r.created) }
                if !r.previous.isEmpty { self.put(r.key, r.previous) }
            }
        }
    }

    // MARK: Datum vjenčanja

    /// Datum vjenčanja kao "yyyy-MM-dd" (prazno = nije postavljen); sprema se u postavke.
    var weddingDate: String { data.settings.string("weddingDate") ?? "" }

    func setWeddingDate(_ value: String) {
        var settings = data.settings
        settings["weddingDate"] = .string(value)
        put("settings", [settings])
    }

    // MARK: Prvo pokretanje

    /// Treba li pokazati uvodni ekran: novo vjenčanje bez naslova koje korisnik nije preskočio.
    var needsOnboarding: Bool {
        (data.settings.string("weddingTitle") ?? "").isEmpty && !data.settings.isTruthy("onboardingDone")
    }

    /// Završava uvod: imena (ako su upisana) postaju mladenci i naslov, datum je neobavezan.
    func finishOnboarding(bride: String, groom: String, date: String) {
        let b = bride.trimmingCharacters(in: .whitespacesAndNewlines)
        let g = groom.trimmingCharacters(in: .whitespacesAndNewlines)
        var after = data
        if !b.isEmpty || !g.isEmpty {
            var names = Array(repeating: "", count: WeddingParty.slots.count)
            names[2] = b
            names[3] = g
            after.saveWeddingParty(names: names)
            after.settings["weddingTitle"] = .string([b, g].filter { !$0.isEmpty }.joined(separator: " i "))
        }
        if !date.isEmpty { after.settings["weddingDate"] = .string(date) }
        after.settings["onboardingDone"] = .bool(true)
        _ = commit(after)
    }

    // MARK: Mladenci i kumovi

    func partyNames() -> [String] {
        WeddingParty.slots.map { data.partyMember($0)?.string("name") ?? "" }
    }

    func saveWeddingParty(names: [String]) {
        var after = data
        after.saveWeddingParty(names: names)
        let undo = commit(after)
        show("Mladenci i kumovi su spremljeni", undo: undo)
    }

    // MARK: Uvoz popisa gostiju

    private static let categoryColors = ["#7B9E87", "#7A8FA6", "#B07B72", "#9B8EA8", "#8A9A6A", "#C4956A", "#6B8FAA", "#A88FA8"]

    /// Dodaje goste iz zalijepljenog popisa; parovi i obitelji sjede zajedno.
    @discardableResult
    func importGuests(_ rows: [ImportRow], defaultCategoryId: String?, includeExisting: Bool) -> ImportPreview {
        var wedding = data
        let preview = GuestImport.preview(rows, existingNames: wedding.guests.compactMap { $0.string("name") },
                                          includeExisting: includeExisting)
        var catByName: [String: String] = [:]
        for c in wedding.categories { if let n = c.string("name"), let id = c.id { catByName[n.lowercased()] = id } }
        var groups: [[String]] = []
        for row in preview.rows {
            var categoryId = defaultCategoryId
            if let name = row.category {
                let key = name.lowercased()
                if catByName[key] == nil {
                    let id = UUID().uuidString.lowercased()
                    wedding.categories.append(Record([
                        "id": .string(id), "name": .string(name),
                        "color": .string(Self.categoryColors[wedding.categories.count % Self.categoryColors.count]),
                        "atHeadTable": .bool(false)
                    ]))
                    catByName[key] = id
                }
                categoryId = catByName[key]
            }
            var ids: [String] = []
            for name in row.names {
                let id = UUID().uuidString.lowercased()
                wedding.guests.append(Record([
                    "id": .string(id), "name": .string(name),
                    "categoryId": categoryId.map { .string($0) } ?? .null,
                    "status": .string("unassigned"), "tableId": .null, "seatIndex": .null,
                    "locked": .bool(false), "notes": .string("")
                ]))
                ids.append(id)
            }
            if ids.count > 1 { groups.append(ids) }
        }
        if !groups.isEmpty { wedding.rules = wedding.rulesAfterAddingTogether(groups) }
        let undo = commit(wedding)
        if preview.guests > 0 { show("Dodano gostiju: \(preview.guests)", undo: undo) }
        return preview
    }
}
