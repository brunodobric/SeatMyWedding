/**
 * Firebase konfiguracija
 *
 * Potrebno u Firebase konzoli:
 * 1. Authentication → Sign-in method → Google + Email/Password
 * 2. Firestore Database → Create database
 * 3. Firestore → Rules → vidi firestore.rules
 */
var firebaseConfig = {
  apiKey: "AIzaSyBEDsXIAjTXi-VZJ9d_C1EKIiPzz1w5Fqo",
  authDomain: "seatmywedding-9139e.firebaseapp.com",
  projectId: "seatmywedding-9139e",
  storageBucket: "seatmywedding-9139e.firebasestorage.app",
  messagingSenderId: "328765575333",
  appId: "1:328765575333:web:1352dbafffdd8f87963d4c",
  measurementId: "G-JGTDGC3SJ8"
};

// The website's key only accepts requests from the website's addresses, and the
// iOS/Android app has none, so the app uses its own key (Google Cloud →
// Credentials, limited to Identity Toolkit, Token Service and Firestore APIs).
var NATIVE_APP_API_KEY = 'AIzaSyAx1Hm-8dKv1Yzus40txATVwbaPdLij6CY';
if (typeof isNativeApp !== 'undefined' && isNativeApp && NATIVE_APP_API_KEY) {
  firebaseConfig.apiKey = NATIVE_APP_API_KEY;
}

// Init only once (avoid crash if script loads twice). If the SDK failed to
// load (offline, blocked CDN) the app keeps working locally without login.
var auth = null;
if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    auth = firebase.auth();
  } catch (e) {
    console.warn('[Firebase] init nije uspio – aplikacija radi bez prijave.', e);
  }
}
