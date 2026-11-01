import SwiftUI
import SeatingCore

/// Početni ekran: datum i odbrojavanje, mladenci i kumovi, broj gostiju i statistika rasporeda.
struct DashboardView: View {
    @Environment(WeddingStore.self) private var store
    @State private var editingDate = false
    @State private var editingParty = false
    @State private var showSettings = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var titleScrolledAway = false

    private static let storageFormat: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private var date: Date? {
        store.weddingDate.isEmpty ? nil : Self.storageFormat.date(from: store.weddingDate)
    }

    private var title: String {
        let t = store.data.settings.string("weddingTitle") ?? ""
        return t.isEmpty ? "Moje Vjenčanje" : t
    }

    private var guestCount: Int { store.data.capacityInfo().guests }
    private var seatedCount: Int { store.invitedGuests.filter { !($0.string("tableId") ?? "").isEmpty }.count }
    private var emptyTables: Int {
        let used = Set(store.guests.compactMap { $0.string("tableId") }.filter { !$0.isEmpty })
        return store.tables.filter { !used.contains($0.id ?? "") }.count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Text(title)
                        .font(.largeTitle.bold())
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                        .background(GeometryReader { g in
                            Color.clear.preference(key: TitleBottomKey.self, value: g.frame(in: .named("dashboard")).maxY)
                        })
                    if sizeClass == .regular {
                        // Široki zaslon: dva jednaka stupca (paran broj, da se sadržaj čisto dijeli pri pregibu).
                        HStack(alignment: .top, spacing: 16) {
                            VStack(spacing: 16) { dateCard; partyCard }
                            statsCard
                        }
                    } else {
                        dateCard
                        partyCard
                        statsCard
                    }
                }
                .padding(16)
            }
            .coordinateSpace(name: "dashboard")
            .onPreferenceChange(TitleBottomKey.self) { titleScrolledAway = $0 < 8 }
            .background(Theme.background)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title).font(.headline).foregroundStyle(Theme.ink)
                        .opacity(titleScrolledAway ? 1 : 0)
                        .animation(.easeInOut(duration: 0.15), value: titleScrolledAway)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Postavke")
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .sheet(isPresented: Binding(get: { store.needsOnboarding }, set: { _ in })) { OnboardingView() }
            .sheet(isPresented: $editingDate) { DateEditView() }
            .sheet(isPresented: $editingParty) { PartyView() }
        }
    }

    private var dateCard: some View {
        Card(title: "Datum vjenčanja", action: date == nil ? "Postavi" : "Uredi") { editingDate = true } content: {
            if let date {
                let days = Calendar.current.dateComponents(
                    [.day], from: Calendar.current.startOfDay(for: .now), to: Calendar.current.startOfDay(for: date)).day ?? 0
                VStack(alignment: .leading, spacing: 4) {
                    Text(date.formatted(.dateTime.day().month(.wide).year().locale(Locale(identifier: "hr_HR"))))
                        .font(Theme.uiBold(18))
                    Text(countdown(days))
                        .font(Theme.title(30))
                        .foregroundStyle(Theme.goldDeep)
                }
            } else {
                Text("Datum još nije postavljen.").font(Theme.ui(16)).foregroundStyle(.secondary)
            }
        }
    }

    private func countdown(_ days: Int) -> String {
        if days == 0 { return "Danas je veliki dan!" }
        if days < 0 { return "Prošlo je \(-days) \(-days % 10 == 1 && -days % 100 != 11 ? "dan" : "dana")" }
        return "Još \(days) \(days % 10 == 1 && days % 100 != 11 ? "dan" : "dana")"
    }

    private var partyCard: some View {
        let names = store.partyNames()
        let couple = [names[2], names[3]].filter { !$0.isEmpty }
        let witnesses = [names[1], names[4]].filter { !$0.isEmpty }
        let plus = [names[0], names[5]].filter { !$0.isEmpty }
        return Card(title: "Mladenci i kumovi", action: "Uredi") { editingParty = true } content: {
            if couple.isEmpty && witnesses.isEmpty && plus.isEmpty {
                Text("Još nitko nije unesen.").font(Theme.ui(16)).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    if !couple.isEmpty { row("Mladenci", couple) }
                    if !witnesses.isEmpty { row("Kumovi", witnesses) }
                    if !plus.isEmpty { row("Pratnja", plus) }
                }
            }
        }
    }

    private func row(_ label: String, _ values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Theme.ui(13)).foregroundStyle(.secondary)
            Text(values.joined(separator: " i ")).font(Theme.uiBold(17))
        }
    }

    private var statsCard: some View {
        Card(title: "Statistika") {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                stat("Gosti", guestCount)
                stat("Raspoređeno", seatedCount)
                stat("Stolovi", store.tables.count)
                stat("Prazni stolovi", emptyTables)
            }
        }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(Theme.title(28)).foregroundStyle(Theme.goldDeep)
            Text(label).font(Theme.ui(13)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Theme.champagne, in: RoundedRectangle(cornerRadius: 10))
    }

    fileprivate static func store(_ d: Date) -> String { storageFormat.string(from: d) }
    fileprivate static func parse(_ s: String) -> Date? { storageFormat.date(from: s) }
}

private struct Card<Content: View>: View {
    let title: String
    var action: String? = nil
    var onAction: () -> Void = {}
    @ViewBuilder var content: Content

    init(title: String, action: String? = nil, onAction: @escaping () -> Void = {}, @ViewBuilder content: () -> Content) {
        self.title = title
        self.action = action
        self.onAction = onAction
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(Theme.ui(14)).foregroundStyle(Theme.bronze).textCase(.uppercase)
                Spacer()
                if let action { Button(action, action: onAction).font(Theme.ui(15)).tint(Theme.goldDeep) }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border))
    }
}

private struct DateEditView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date.now
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Datum", selection: $date, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.locale, Locale(identifier: "hr_HR"))
                if !store.weddingDate.isEmpty {
                    Button("Ukloni datum", role: .destructive) {
                        store.setWeddingDate("")
                        dismiss()
                    }
                }
            }
            .navigationTitle("Datum vjenčanja")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Odustani") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Spremi") {
                        store.setWeddingDate(DashboardView.store(date))
                        dismiss()
                    }
                }
            }
            .onAppear {
                guard !loaded else { return }
                loaded = true
                if let d = DashboardView.parse(store.weddingDate) { date = d }
            }
        }
    }
}

private struct OnboardingView: View {
    @Environment(WeddingStore.self) private var store
    @State private var bride = ""
    @State private var groom = ""
    @State private var hasDate = false
    @State private var date = Date.now

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Mladenka", text: $bride).textInputAutocapitalization(.words)
                    TextField("Mladoženja", text: $groom).textInputAutocapitalization(.words)
                } header: {
                    Text("Tko se vjenča?")
                } footer: {
                    Text("Kume i pratnju možeš dodati poslije na Dashboardu.")
                }
                    .listRowBackground(Theme.surface)
                Section {
                    Toggle("Znam datum vjenčanja", isOn: $hasDate.animation())
                    if hasDate {
                        DatePicker("Datum", selection: $date, displayedComponents: .date)
                            .environment(\.locale, Locale(identifier: "hr_HR"))
                    }
                }
                    .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Dobro došli")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Preskoči") { store.finishOnboarding(bride: "", groom: "", date: "") }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Počni") {
                        store.finishOnboarding(bride: bride, groom: groom, date: hasDate ? DashboardView.store(date) : "")
                    }
                }
            }
        }
        .interactiveDismissDisabled()
    }
}

private struct TitleBottomKey: PreferenceKey {
    static let defaultValue: CGFloat = 100
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// Izgled aplikacije: prati sustav ili je uvijek svijetao/tamni.
enum AppearanceChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return "Automatski"
        case .light: return "Svijetli"
        case .dark: return "Tamni"
        }
    }
    var scheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

private struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearance") private var appearance = AppearanceChoice.system

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Izgled", selection: $appearance) {
                        ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Tema")
                } footer: {
                    Text("Automatski prati postavku telefona.")
                }
                    .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Postavke")
            .navigationBarTitleDisplayMode(.large)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Gotovo") { dismiss() } } }
        }
        // Prozor sa sheetom ne preuzima odmah promjenu s korijena, pa izgled postavljamo i ovdje.
        .preferredColorScheme(appearance.scheme)
    }
}
