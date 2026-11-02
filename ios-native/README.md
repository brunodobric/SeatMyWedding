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
  na stolove, tamna tema, iPhone Duo i iPad; lokalno spremanje, brisanje svih podataka; iCloud sinkronizacija je pripremljena, ali isključena). Xcode projekt se generira alatom
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

## iCloud (CloudKit)

Sinkronizacija koristi privatnu CloudKit bazu korisnika (bez prijave u aplikaciju).
Cijelo vjenčanje je jedan zapis `Wedding` u zoni `Wedding` s JSON dokumentom istog
oblika kao na webu; spajanje je zapis po zapis, pobjeđuje zadnja promjena (`App/CloudSync.swift`).

Zasad je isključena (`CloudSync.isAvailable = false`) jer traži plaćeni Apple Developer račun.
Za uključivanje: stavi `isAvailable = true`, odkomentiraj iCloud blok u `project.yml`, pa ručno, jednom:

1. U Xcodeu, Signing & Capabilities: odaberi svoj Team (plaćeni Apple Developer račun).
   Xcode tada sam registrira iCloud spremnik `iCloud.com.seatmywedding.app` i push obavijesti.
2. Na simulatoru ili uređaju prijavi se u iCloud (Settings → Apple račun).
3. Prije izlaska na App Store: u CloudKit Consoleu (icloud.developer.apple.com) napravi
   "Deploy Schema Changes" iz Development u Production, i promijeni `aps-environment` u `production`
   (Xcode to radi sam kod arhiviranja za App Store).

