/**
 * Firebase konfiguracija
 * 1. Idi na https://console.firebase.google.com
 * 2. Kreiraj projekt (ili otvori postojeći)
 * 3. Authentication → Sign-in method → uključi Google i Email/Password
 * 4. Project settings → Your apps → Web app → kopiraj firebaseConfig
 * 5. Zamijeni vrijednosti ispod
 */
const firebaseConfig = {
  apiKey: "AIzaSyBEDsXIAjTXi-VZJ9d_C1EKIiPzz1w5Fqo",
  authDomain: "seatmywedding-9139e.firebaseapp.com",
  projectId: "seatmywedding-9139e",
  storageBucket: "seatmywedding-9139e.firebasestorage.app",
  messagingSenderId: "328765575333",
  appId: "1:328765575333:web:1352dbafffdd8f87963d4c",
  measurementId: "G-JGTDGC3SJ8"
};


// Inicijalizacija (compat SDK)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
