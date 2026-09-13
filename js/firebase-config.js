/**
 * Firebase konfiguracija
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

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    var auth = firebase.auth();
  } else {
    console.error('[Firebase] SDK nije učitan – provjeri mrežu / script tagove.');
    var auth = null;
  }
} catch (e) {
  console.error('[Firebase] init failed', e);
  var auth = null;
}
