import CloudKit
import Foundation
import Observation
import SeatingCore
import UIKit

/// Sinkronizacija s iCloudom (CloudKit, privatna baza korisnika). Cijelo vjenčanje je
/// jedan zapis s JSON dokumentom istog oblika kao na webu (`SyncState.toCloudDoc`).
/// Spajanje je zapis po zapis (gost, stol, pravilo...), pobjeđuje zadnja promjena,
/// a brisanja se prenose nadgrobnim oznakama. Radi i bez mreže: lokalna datoteka
/// ostaje glavna, a oblak se sustigne kad veza opet postoji.
@MainActor
@Observable
final class CloudSync {
    enum Status: Equatable {
        case off
        case noAccount
        case syncing
        case synced(Date)
        case failed(String)
    }

    /// Isključeno dok ne postoji plaćeni Apple Developer račun: bez iCloud ovlasti (entitlements)
    /// CloudKit ruši aplikaciju. Za uključivanje: stavi `true` i vrati iCloud blok u project.yml.
    static let isAvailable = false
    static let containerID = "iCloud.com.seatmywedding.app"
    private static let zoneID = CKRecordZone.ID(zoneName: "Wedding", ownerName: CKCurrentUserDefaultName)
    private static let recordID = CKRecord.ID(recordName: "wedding", zoneID: zoneID)
    private static let recordType = "Wedding"
    private static let enabledKey = "iCloudSync"
    private static let zoneReadyKey = "iCloudZoneReady"
    private static let subscriptionKey = "iCloudSubscriptionReady"

    private(set) var status: Status = .off
    private let store: WeddingStore
    /// Spremnik se stvara tek kad je sync uključen (bez iCloud ovlasti aplikacija bi inače pala).
    @ObservationIgnored private var cachedContainer: CKContainer?
    private var container: CKContainer {
        if let c = cachedContainer { return c }
        let c = CKContainer(identifier: Self.containerID)
        cachedContainer = c
        return c
    }
    private var database: CKDatabase { container.privateCloudDatabase }
    @ObservationIgnored private var running = false
    @ObservationIgnored private var again = false
    @ObservationIgnored private var debounce: Task<Void, Never>?

    var isEnabled: Bool = CloudSync.isAvailable && (UserDefaults.standard.object(forKey: CloudSync.enabledKey) as? Bool ?? true) {
        didSet {
            UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey)
            if isEnabled { syncNow() } else { debounce?.cancel(); status = .off }
        }
    }

    init(store: WeddingStore) {
        self.store = store
        store.onLocalChange = { [weak self] in self?.scheduleSync() }
    }

    /// Nakon lokalne izmjene: pričekaj malo da se skupi više izmjena u jedno slanje.
    func scheduleSync() {
        guard isEnabled else { return }
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            self?.syncNow()
        }
    }

    func syncNow() {
        guard Self.isAvailable, isEnabled else { status = .off; return }
        if running { again = true; return }
        running = true
        Task {
            repeat {
                again = false
                await run()
            } while again && isEnabled
            running = false
        }
    }

    // MARK: Jedan krug: preuzmi, spoji, pošalji

    private func run() async {
        status = .syncing
        do {
            let account = try await container.accountStatus()
            guard account == .available else { status = .noAccount; return }
            try await prepare()
            // Ako je netko drugi u međuvremenu promijenio zapis, ponovi s novim stanjem.
            for attempt in 1...3 {
                do {
                    try await exchange()
                    break
                } catch let error as CKError where error.code == .serverRecordChanged && attempt < 3 {
                    continue
                }
            }
            status = .synced(.now)
        } catch let error as CKError where error.code == .zoneNotFound || error.code == .userDeletedZone {
            // Korisnik je obrisao podatke aplikacije u iCloudu: stvori zonu ponovno pri sljedećem pokušaju.
            UserDefaults.standard.set(false, forKey: Self.zoneReadyKey)
            UserDefaults.standard.set(false, forKey: Self.subscriptionKey)
            status = .failed("Podaci u iCloudu su obrisani. Sinkroniziraj ponovno da se pošalju s ovog uređaja.")
        } catch let error as CKError where error.code == .notAuthenticated {
            status = .noAccount
        } catch let error as CKError where error.code == .networkUnavailable || error.code == .networkFailure {
            status = .failed("Nema veze s internetom. Podaci su spremljeni na uređaju.")
        } catch {
            status = .failed("iCloud trenutno nije dostupan.")
        }
    }

    /// Zona i pretplata na promjene stvaraju se jednom po uređaju.
    private func prepare() async throws {
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: Self.zoneReadyKey) {
            _ = try await database.modifyRecordZones(saving: [CKRecordZone(zoneID: Self.zoneID)], deleting: [])
            defaults.set(true, forKey: Self.zoneReadyKey)
        }
        if !defaults.bool(forKey: Self.subscriptionKey) {
            // Tiha obavijest kad se podaci promijene na drugom uređaju.
            let sub = CKDatabaseSubscription(subscriptionID: "wedding-changes")
            let info = CKSubscription.NotificationInfo()
            info.shouldSendContentAvailable = true
            sub.notificationInfo = info
            _ = try await database.modifySubscriptions(saving: [sub], deleting: [])
            defaults.set(true, forKey: Self.subscriptionKey)
        }
    }

    private func exchange() async throws {
        let existing: CKRecord?
        do {
            existing = try await database.record(for: Self.recordID)
        } catch let error as CKError where error.code == .unknownItem {
            existing = nil
        }
        let now = (Date().timeIntervalSince1970 * 1000).rounded()
        let remote = try existing.map { try Self.state(from: $0) }
        let local = store.sync
        // Kod jednakog vremena prednost ima uređaj.
        let merged = remote.map { SyncState.merge($0, local, preferB: true, now: now) } ?? local
        store.applyMerged(merged)
        if let remote, merged.isEquivalent(to: remote) { return }

        let record = existing ?? CKRecord(recordType: Self.recordType, recordID: Self.recordID)
        let bytes = try JSONEncoder().encode(merged.toCloudDoc(now: now))
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("icloud-\(UUID().uuidString).json")
        try bytes.write(to: file, options: .atomic)
        defer { try? FileManager.default.removeItem(at: file) }
        record["doc"] = CKAsset(fileURL: file)
        record["updatedAt"] = now as NSNumber
        // Sprema samo ako se zapis u oblaku nije promijenio otkad smo ga pročitali.
        let result = try await database.modifyRecords(
            saving: [record], deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: true)
        if case .failure(let error) = result.saveResults[Self.recordID] { throw error }
    }

    private static func state(from record: CKRecord) throws -> SyncState {
        guard let url = (record["doc"] as? CKAsset)?.fileURL else { return SyncState() }
        let json = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
        return SyncState.fromCloudDoc(json)
    }

    // MARK: Opis za Postavke

    var statusText: String {
        switch status {
        case .off: return "Podaci se čuvaju samo na ovom uređaju."
        case .noAccount: return "Prijavi se u iCloud u Postavkama uređaja da bi se podaci sinkronizirali."
        case .syncing: return "Sinkroniziram…"
        case .synced(let date):
            return "Sinkronizirano u \(date.formatted(.dateTime.hour().minute().locale(Locale(identifier: "hr_HR"))))."
        case .failed(let message): return message
        }
    }
}

/// Tihe obavijesti iz CloudKita (promjena na drugom uređaju) pokreću sinkronizaciju.
final class AppDelegate: NSObject, UIApplicationDelegate {
    @MainActor static var onRemoteChange: (@MainActor () -> Void)?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        if CloudSync.isAvailable { application.registerForRemoteNotifications() }
        return true
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any])
        async -> UIBackgroundFetchResult {
        await MainActor.run { AppDelegate.onRemoteChange?() }
        return .newData
    }
}
