import SwiftUI

/// Veliki naslov ekrana koji se pri pomicanju smanjuje u sredinu trake (kao standardni iOS
/// veliki naslov). Crta se u sadržaju, jer se sustavni veliki naslov uz našu izgled trake
/// ne iscrtava dok se ne pomakne. Koristi se uz `.screenTitle(_:)` na istom ekranu.
struct ScreenTitleHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.largeTitle.bold())
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
            .background(GeometryReader { g in
                Color.clear.preference(key: ScreenTitleKey.self, value: g.frame(in: .named(ScreenTitleSpace.name)).maxY)
            })
    }
}

private enum ScreenTitleSpace { static let name = "screenTitle" }

/// Donji rub velikog naslova u prostoru ekrana. Kad se redak naslova ukloni iz popisa
/// (jer je odskrolan), vrijednost se vraća na 0, što znači "naslov je gore".
private struct ScreenTitleKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct ScreenTitleModifier: ViewModifier {
    let title: String
    @State private var scrolledAway = false

    func body(content: Content) -> some View {
        content
            .coordinateSpace(name: ScreenTitleSpace.name)
            .onPreferenceChange(ScreenTitleKey.self) { scrolledAway = $0 < 8 }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title).font(.headline).foregroundStyle(Theme.ink)
                        .opacity(scrolledAway ? 1 : 0)
                        .animation(.easeInOut(duration: 0.15), value: scrolledAway)
                }
            }
    }
}

extension View {
    func screenTitle(_ title: String) -> some View { modifier(ScreenTitleModifier(title: title)) }
}

extension View {
    /// Redak popisa za veliki naslov: bez pozadine, razdjelnika i uvlaka.
    func screenTitleRow() -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    }
}
