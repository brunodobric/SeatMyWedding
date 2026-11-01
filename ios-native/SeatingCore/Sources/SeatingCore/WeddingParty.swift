import Foundation

/// Mjesto za stolom mladenaca (slijeva nadesno): pratnja kume, kuma, mladenka,
/// mladoženja, kum, pratnja kuma. Port js/app.js (OB_PARTY_FIELDS, saveWeddingParty).
public struct PartySlot: Equatable, Sendable {
    public let slot: String
    public let seat: Int
    public let isCouple: Bool
    public let label: String
}

public enum WeddingParty {
    public static let slots: [PartySlot] = [
        PartySlot(slot: "kuma-plus", seat: 0, isCouple: false, label: "Pratnja kume"),
        PartySlot(slot: "kuma", seat: 1, isCouple: false, label: "Kuma"),
        PartySlot(slot: "bride", seat: 2, isCouple: true, label: "Mladenka"),
        PartySlot(slot: "groom", seat: 3, isCouple: true, label: "Mladoženja"),
        PartySlot(slot: "kum", seat: 4, isCouple: false, label: "Kum"),
        PartySlot(slot: "kum-plus", seat: 5, isCouple: false, label: "Pratnja kuma")
    ]

    /// Uloga osobe (za izvoz i ispis); prazno za obične goste.
    public static func role(_ guest: Record) -> String {
        guard guest.isTruthy("party") else { return "" }
        if let s = guest.string("partySlot"), let found = slots.first(where: { $0.slot == s }) { return found.label }
        return guest.string("party") == "couple" ? "Mladenci" : "Kumovi"
    }
}

extension WeddingData {
    public var headTable: Record? { tables.first { $0.string("shape") == "head" } }

    /// Osoba na zadanom mjestu stola mladenaca (stariji zapisi nemaju oznaku mjesta:
    /// nalaze se po mjestu za stolom).
    public func partyMember(_ slot: PartySlot) -> Record? {
        if let g = guests.first(where: { $0.isTruthy("party") && $0.string("partySlot") == slot.slot }) { return g }
        guard let head = headTable else { return nil }
        return guests.first {
            $0.isTruthy("party") && $0.string("partySlot") == nil
                && $0.string("tableId") == head.id && $0.integer("seatIndex") == Double(slot.seat)
        }
    }

    /// Stol mladenaca s drugim brojem mjesta (krajevi zadržavaju svoja dok ima mjesta sprijeda).
    private func headTable(_ head: Record, withSeats seats: Int) -> Record {
        let end = head.number("seatsEnd") ?? 0
        let seatsEnd = 2 * end < Double(seats) ? end : 0
        var h = head
        h["seats"] = .number(Double(seats))
        h["seatsEnd"] = .number(seatsEnd)
        h["seatsLong"] = .number(Double(seats) - 2 * seatsEnd)
        return h
    }

    /// Sprema imena mladenaca, kumova i pratnje (šest polja, redom iz `WeddingParty.slots`):
    /// novo ime dodaje osobu (ili gosta s tim imenom pretvara u člana), izmijenjeno
    /// preimenuje, prazno uklanja. Stol mladenaca ima onoliko mjesta koliko je ljudi.
    public mutating func saveWeddingParty(names rawNames: [String], makeID: IDMaker = newRecordID) {
        let names = WeddingParty.slots.indices.map { i in
            i < rawNames.count ? rawNames[i].trimmingCharacters(in: .whitespacesAndNewlines) : ""
        }
        let filled = names.filter { !$0.isEmpty }.count
        var head = headTable
        if head == nil {
            if filled == 0 { return }
            let h = Record([
                "id": .string(makeID()), "name": .string("Stol mladenaca"), "shape": .string("head"),
                "seats": .number(Double(filled)), "seatsLong": .number(Double(filled)), "seatsEnd": .number(0),
                "x": .number(500), "y": .number(60), "rotation": .number(0)
            ])
            tables.append(h)
            head = h
        }
        guard let head, let headId = head.id else { return }

        var removed = 0
        var party: [String] = []
        for (i, slot) in WeddingParty.slots.enumerated() {
            let name = names[i]
            let current = partyMember(slot)
            if name.isEmpty {
                if let current, let cid = current.id {
                    guests.removeAll { $0.id == cid }
                    rules = normalizeRules(rules, makeID: makeID)
                    removed += 1
                }
                continue
            }
            if var current, let cid = current.id {
                if current.string("name") != name {
                    current["name"] = .string(name)
                    if let k = guests.firstIndex(where: { $0.id == cid }) { guests[k] = current }
                }
                party.append(cid)
                continue
            }
            let listed = invitedGuests.first {
                ($0.string("name") ?? "").trimmingCharacters(in: .whitespaces).lowercased() == name.lowercased()
            }
            var person = listed ?? Record([
                "id": .string(makeID()), "name": .string(name), "categoryId": .null, "notes": .string(""),
                "status": .string("unassigned"), "tableId": .null, "seatIndex": .null
            ])
            person["party"] = .string(slot.isCouple ? "couple" : "kumovi")
            person["partySlot"] = .string(slot.slot)
            person["locked"] = .bool(true)
            guard let pid = person.id else { continue }
            if let k = guests.firstIndex(where: { $0.id == pid }) { guests[k] = person } else { guests.append(person) }
            party.append(pid)
        }

        // Slijeva nadesno: članovi redom, pa svi ostali koji sjede za tim stolom.
        let partyIds = Set(party)
        let others = guests.enumerated()
            .filter { $0.element.string("tableId") == headId && !partyIds.contains($0.element.id ?? "") }
            .sorted { a, b in
                let sa = a.element.number("seatIndex") ?? 0, sb = b.element.number("seatIndex") ?? 0
                return sa != sb ? sa < sb : a.offset < b.offset
            }
            .compactMap { $0.element.id }
        let order = party + others
        let oldSeats = (head.number("seats") ?? 0).safeInt
        let seats = max(1, order.count, oldSeats - removed)
        func setHead(_ h: Record) {
            if let k = tables.firstIndex(where: { $0.id == headId }) { tables[k] = h }
        }
        if seats > oldSeats { setHead(headTable(head, withSeats: seats)) }
        place(order.enumerated().map { SeatMove(id: $1, tableId: headId, seatIndex: Double($0)) })
        if seats < oldSeats, let current = tables.first(where: { $0.id == headId }) {
            setHead(headTable(current, withSeats: seats))
        }
    }
}
