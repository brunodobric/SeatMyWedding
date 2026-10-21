# iOS aplikacija (Capacitor)

Web stranica i iOS aplikacija koriste iste datoteke. Web stranica se i dalje
objavljuje s GitHub Pagesa iz korijena repozitorija; `npm run build` kopira te
datoteke u `www/`, a Capacitor ih pakira u aplikaciju (`ios/`).

## Jednom, na Macu

1. Instaliraj Xcode iz Mac App Storea i Node.js (https://nodejs.org, LTS).
2. U mapi repozitorija: `npm install`.
3. Firebase konzola → Project settings → Add app → iOS, Bundle ID
   `com.seatmywedding.app`. Preuzmi `GoogleService-Info.plist`.
4. `npm run ios` (otvara Xcode). U Xcodeu:
   - povuci `GoogleService-Info.plist` u mapu **App** (uključi "Copy items if needed" i target **App**);
   - **App → Info → URL Types → +**: u **URL Schemes** upiši vrijednost
     `REVERSED_CLIENT_ID` iz `GoogleService-Info.plist` (potrebno za Google prijavu);
   - **App → Signing & Capabilities**: odaberi svoj tim (Apple Developer račun).
     Sign in with Apple je već uključen.
5. Firebase konzola → Authentication → Sign-in method → uključi **Apple**.
6. Google Cloud konzola → APIs & Services → Credentials → Create credentials →
   API key. Ograniči ga na API-je Identity Toolkit API, Token Service API i
   Cloud Firestore API (bez ograničenja na web stranice). Upiši ga u
   `NATIVE_APP_API_KEY` u `js/firebase-config.js`.

## Svaki put nakon promjene koda

`npm run ios` pa u Xcodeu ▶ (simulator ili iPhone).

## Objava

Xcode → Product → Archive → Distribute App → App Store Connect. Build se
pojavi u App Store Connectu (TestFlight), odakle se šalje na pregled.
Prije svake nove verzije povećaj **Version** ili **Build** u Xcodeu
(App → General).
