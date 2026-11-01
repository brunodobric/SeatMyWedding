import SwiftUI

struct RootView: View {
    @Environment(WeddingStore.self) private var store

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Dashboard", systemImage: "heart.text.square") }
            GuestsView()
                .tabItem { Label("Gosti", systemImage: "person.2") }
            HallView()
                .tabItem { Label("Sala", systemImage: "square.grid.3x3") }
            SeatingView()
                .tabItem { Label("Raspored", systemImage: "list.bullet.rectangle") }
        }
        .overlay(alignment: .bottom) {
            if let toast = store.toast {
                ToastBar(toast: toast)
                    .padding(.bottom, 64)
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
