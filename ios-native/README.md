# SeatMyWedding za iPhone (Swift)

Nativna Swift verzija aplikacije. Plan: https://claude.ai/artifact/SotoqrU2oQsWrk7CykwiEu

## Što je ovdje

- `SeatingCore/` je Swift paket bez ikakvog sučelja: modeli, čišćenje podataka,
  popravci rasporeda i spajanje dva uređaja (sinkronizacija). Ovo je jezgra koju
  koristi aplikacija.
- Podaci su JSON zapisi (`Record`), a ne krute strukture, da polja koja web doda
  ne nestanu kad ih iPhone spremi natrag u oblak.
- Format dokumenta u oblaku (`users/{uid}/data/wedding`, `syncVersion 2`) ostaje
  isti kao na webu.

- `App/` i `project.yml`: SwiftUI aplikacija (Dashboard, Gosti, Sala, Raspored,
  mladenci i kumovi, uvoz popisa i JSON kopije, izvoz i ispis, povlačenje gostiju
  na stolove, tamna tema, iPhone Duo i iPad; lokalno spremanje, bez oblaka i prijave). Xcode projekt se generira alatom
  XcodeGen: `brew install xcodegen && cd ios-native && xcodegen generate && open SeatMyWedding.xcodeproj`.

## Je li Swift isti kao JavaScript

`tools/golden/generate-golden.mjs` pokreće postojeći JavaScript (`js/state.js`,
`js/sync.js`) nad zadanim i nasumičnim ulazima i sprema rezultate u
`SeatingCore/Tests/SeatingCoreTests/Fixtures/golden.json`. Swift testovi
(`GoldenTests.swift`) moraju dati iste rezultate. Ako se JavaScript promijeni,
`node tools/golden/generate-golden.mjs` obnovi datoteku.

Namjerna odstupanja od JavaScripta (rubni slučajevi koje web ne obrađuje
ispravno) opisana su na vrhu `DataCleaning.swift`.

## Pokretanje testova

U Terminalu: `cd ios-native/SeatingCore && swift test`. U Xcodeu: File → Open i
odaberi mapu `ios-native/SeatingCore`, pa ⌘U.
