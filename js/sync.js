/**
 * Cloud sync – Firebase Firestore
 * Struktura: users/{uid}/data/wedding  (jedan dokument s cijelim stanjem)
 * Lokalni IndexedDB ostaje cache + offline podrška.
 */

const CLOUD_COLLECTION = 'users';
const CLOUD_DOC = 'wedding';

let _syncEnabled = false;
let _syncing = false;
let _pushTimer = null;
let _lastPushedAt = 0;
let _cloudUpdatedAt = 0;
let _unsubscribe = null;

function isFirestoreReady() {
  try {
    return typeof firebase !== 'undefined'
      && firebase.firestore
      && typeof isAuthConfigured === 'function'
      && isAuthConfigured();
  } catch {
    return false;
  }
}

function getUserDocRef(uid) {
  return firebase.firestore()
    .collection(CLOUD_COLLECTION)
    .doc(uid)
    .collection('data')
    .doc(CLOUD_DOC);
}

/** Snapshot trenutnog stanja spreman za Firestore */
function buildSnapshot() {
  return {
    settings: { ...state.settings },
    tables: state.tables.map(t => ({ ...t })),
    categories: state.categories.map(c => ({ ...c })),
    guests: state.guests.map(g => ({ ...g })),
    rules: state.rules.map(r => {
      const copy = { ...r };
      // satisfied se računa lokalno – ne spremamo ga
      delete copy.satisfied;
      return copy;
    }),
    updatedAt: Date.now()
  };
}

/** Primijeni snapshot iz clouda na lokalno stanje + IndexedDB */
async function applyCloudSnapshot(data) {
  if (!data) return;
  const payload = {
    settings: data.settings || { id: 'main', weddingTitle: '', monogram: '' },
    tables: data.tables || [],
    categories: data.categories || [],
    guests: data.guests || [],
    rules: data.rules || []
  };
  // Spriječi push petlju dok primjenjujemo cloud podatke
  const wasEnabled = _syncEnabled;
  _syncEnabled = false;
  clearTimeout(_pushTimer);
  try {
    await importData(payload);
    _cloudUpdatedAt = data.updatedAt || 0;
    _lastPushedAt = data.updatedAt || 0;
  } finally {
    _syncEnabled = wasEnabled;
  }
}

/** Push lokalnog stanja u Firestore (debounce) */
function scheduleCloudPush(delay = 1200) {
  if (!_syncEnabled || !currentUser) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => pushToCloud(), delay);
}

async function pushToCloud() {
  if (!_syncEnabled || !currentUser || _syncing) return;
  if (!navigator.onLine) {
    setSyncStatus('offline');
    return;
  }
  _syncing = true;
  setSyncStatus('syncing');
  try {
    const snap = buildSnapshot();
    await getUserDocRef(currentUser.uid).set(snap, { merge: false });
    _lastPushedAt = snap.updatedAt;
    _cloudUpdatedAt = snap.updatedAt;
    setSyncStatus('synced');
  } catch (err) {
    console.error('[Sync] push failed', err);
    setSyncStatus('error');
    if (typeof showToast === 'function') {
      showToast('Sinkronizacija nije uspjela: ' + (err.message || 'mrežna greška'), true);
    }
  } finally {
    _syncing = false;
  }
}

/** Dohvati cloud dokument */
async function pullFromCloud() {
  if (!currentUser) return null;
  const ref = getUserDocRef(currentUser.uid);
  const doc = await ref.get();
  if (!doc.exists) return null;
  return doc.data();
}

/**
 * Nakon prijave:
 * - ako cloud prazan → push lokalnih podataka
 * - ako lokalno prazno (nema naslova) → povuci cloud
 * - inače: cloud noviji → povuci; lokalni noviji → push
 * - real-time listener za promjene s drugih uređaja
 */
async function onAuthForSync(user) {
  if (!isFirestoreReady()) {
    _syncEnabled = false;
    setSyncStatus('off');
    return;
  }

  // Odjava – ugasi listener
  if (!user) {
    _syncEnabled = false;
    if (_unsubscribe) {
      _unsubscribe();
      _unsubscribe = null;
    }
    setSyncStatus('off');
    return;
  }

  _syncEnabled = true;
  setSyncStatus('syncing');

  try {
    const cloud = await pullFromCloud();
    const localHasData = !!(state.settings.weddingTitle || state.tables.length || state.guests.length);
    const cloudHasData = !!(cloud && (cloud.settings?.weddingTitle || (cloud.tables && cloud.tables.length) || (cloud.guests && cloud.guests.length)));

    if (!cloudHasData && localHasData) {
      // Prvi put – upload lokalnih podataka
      await pushToCloud();
    } else if (cloudHasData && !localHasData) {
      // Lokalno prazno – preuzmi cloud
      await applyCloudSnapshot(cloud);
      if (typeof renderAll === 'function') renderAll();
      if (typeof showToast === 'function') showToast('Podaci preuzeti iz clouda');
    } else if (cloudHasData && localHasData) {
      const cloudTs = cloud.updatedAt || 0;
      // Ako cloud znatno noviji (> 2 s), preuzmi; inače push
      if (cloudTs > _lastPushedAt + 2000) {
        await applyCloudSnapshot(cloud);
        if (typeof renderAll === 'function') renderAll();
        if (typeof showToast === 'function') showToast('Sinkronizirano s cloudom');
      } else {
        await pushToCloud();
      }
    } else {
      setSyncStatus('synced');
    }

    // Real-time listener (druga uređaja / tabovi)
    if (_unsubscribe) _unsubscribe();
    _unsubscribe = getUserDocRef(user.uid).onSnapshot(
      async doc => {
        if (!doc.exists || _syncing) return;
        const data = doc.data();
        const ts = data.updatedAt || 0;
        // Ignoriraj vlastiti push
        if (ts <= _lastPushedAt) return;
        if (ts <= _cloudUpdatedAt) return;
        _cloudUpdatedAt = ts;
        await applyCloudSnapshot(data);
        if (typeof renderAll === 'function') renderAll();
        if (typeof updateHeader === 'function') updateHeader();
        setSyncStatus('synced');
      },
      err => {
        console.error('[Sync] listener error', err);
        setSyncStatus('error');
      }
    );
  } catch (err) {
    console.error('[Sync] onAuth error', err);
    setSyncStatus('error');
  }
}

/** UI indikator u headeru */
function setSyncStatus(status) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = 'sync-status ' + status;
  const labels = {
    off: '',
    synced: '☁ Sinkronizirano',
    syncing: '☁ Sinkronizacija…',
    offline: '☁ Izvan mreže',
    error: '☁ Greška'
  };
  el.textContent = labels[status] || '';
  el.title = labels[status] || '';
  el.style.display = status === 'off' ? 'none' : '';
}

function setupSync() {
  if (!isFirestoreReady()) {
    console.warn('[Sync] Firestore nije spreman – provjeri firebase-config.js i da je Firestore omogućen u konzoli.');
    return;
  }

  // Omogući offline persistenciju
  try {
    firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(err => {
      if (err.code === 'failed-precondition') {
        // Više tabova – OK, persistencija samo u jednom
      } else if (err.code === 'unimplemented') {
        console.warn('[Sync] Browser ne podržava offline persistenciju');
      }
    });
  } catch (e) { /* ignore */ }

  // Reagiraj na auth promjene
  window.addEventListener('authChange', e => {
    onAuthForSync(e.detail?.user || null);
  });

  // Debounced push na svaku lokalnu promjenu
  window.addEventListener('stateChange', () => {
    if (_syncEnabled && currentUser) scheduleCloudPush();
  });

  // Online/offline
  window.addEventListener('online', () => {
    if (_syncEnabled && currentUser) {
      setSyncStatus('syncing');
      scheduleCloudPush(300);
    }
  });
  window.addEventListener('offline', () => {
    if (_syncEnabled) setSyncStatus('offline');
  });

  // Ako je korisnik već prijavljen (npr. refresh)
  if (typeof currentUser !== 'undefined' && currentUser) {
    onAuthForSync(currentUser);
  }
}

/** Ručni sync (opcionalno – gumb) */
async function forceSyncNow() {
  if (!currentUser) {
    if (typeof showToast === 'function') showToast('Prijavite se za cloud sync');
    return;
  }
  await pushToCloud();
  if (typeof showToast === 'function') showToast('Podaci spremljeni u cloud');
}
