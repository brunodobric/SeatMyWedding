import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard, guests, hall, seating
    var id: String { rawValue }
    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .guests: return "Gosti"
        case .hall: return "Sala"
        case .seating: return "Raspored"
        }
    }
    var icon: String {
        switch self {
        case .dashboard: return "heart.text.square"
        case .guests: return "person.2"
        case .hall: return "square.grid.3x3"
        case .seating: return "list.bullet.rectangle"
        }
    }
}

/// Uski zaslon (zatvoren preklopni iPhone, običan iPhone): donja traka tabova.
/// Široki zaslon (otvoreni preklopni iPhone, iPad): bočni izbornik slijeva.
/// Odabrani dio ostaje isti kad se zaslon sklopi ili otvori.
struct RootView: View {
    @Environment(WeddingStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var section: AppSection = .dashboard

    private var wide: Bool { sizeClass == .regular }

    @ViewBuilder
    private func content(_ s: AppSection) -> some View {
        switch s {
        case .dashboard: DashboardView()
        case .guests: GuestsView()
        case .hall: HallView()
        case .seating: SeatingView()
        }
    }

    var body: some View {
        Group {
            if wide {
                NavigationSplitView {
                    List(AppSection.allCases, selection: Binding<AppSection?>(
                        get: { section }, set: { if let v = $0 { section = v } }
                    )) { s in
                        Label(s.title, systemImage: s.icon)
                            .font(Theme.ui(17))
                            .tag(s)
                    }
                    .navigationTitle("SeatMyWedding")
                    .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 300)
                    .scrollContentBackground(.hidden)
                    .background(Theme.background)
                } detail: {
                    content(section)
                }
            } else {
                TabView(selection: $section) {
                    ForEach(AppSection.allCases) { s in
                        content(s)
                            .tabItem { Label(s.title, systemImage: s.icon) }
                            .tag(s)
                    }
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = store.toast {
                ToastBar(toast: toast)
                    .padding(.bottom, wide ? 16 : 64)
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: store.toast?.id)
    }
}

private struct ToastBar: View {
    @Environment(WeddingStore.self) private var store
    let toast: WeddingStore.Toast

    var body: some View {
        HStack(spacing: 12) {
            Text(toast.message)
                .font(Theme.ui(15))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let undo = toast.undo {
                Button("Poništi") {
                    undo()
                    store.dismissToast()
                }
                .font(Theme.uiBold(15))
                .foregroundStyle(Theme.gold)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(toast.isError ? Theme.error : Theme.ink, in: RoundedRectangle(cornerRadius: 12))
        .shadow(radius: 6, y: 2)
    }
}
