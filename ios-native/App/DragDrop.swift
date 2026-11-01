import SwiftUI
import UniformTypeIdentifiers
import SeatingCore

/// Gost koji se povlači s popisa na stol. Nosi identitet gosta (ne samo ime), pa se
/// dva gosta istog imena ne mogu zamijeniti. Ne izlaže se kao tekst, da ga odredište za
/// imena iz drugih aplikacija ne prepozna po imenu.
struct GuestDragItem: Codable, Transferable {
    var id: String
    var name: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .json)
    }
}

extension WeddingStore {
    /// Ime ispušteno na stol iz druge aplikacije (npr. iz Poruka u Split Viewu):
    /// postojeći gost s tim imenom se smješta, a nepoznato ime postaje novi gost.
    @discardableResult
    func dropName(_ raw: String, onto tableId: String) -> Bool {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 120, !name.contains("\n") else { return false }
        let existing = invitedGuests.first { ($0.string("name") ?? "").localizedCaseInsensitiveCompare(name) == .orderedSame }
        let id = existing?.id ?? saveGuest(id: nil, name: name, categoryId: nil, notes: "", locked: false, maybe: false)
        drop(id, onto: .table(tableId: tableId))
        return true
    }
}
