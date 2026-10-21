/**
 * Cloud sync – Firebase Firestore
 * Struktura: users/{uid}/data/wedding  (jedan dokument s cijelim stanjem)
 * Lokalni IndexedDB ostaje cache + offline podrška.
 *
 * Two devices are merged record by record (syncVersion 2): every guest, table,
 * category, rule and the settings carry updatedAt, deletions are kept as
 * tombstones in `deleted`, and for each record the latest change wins. A push
 * reads the cloud copy and writes the merge in one transaction, so changes made
 * on another device (also offline) are never overwritten by an older copy.
 * Documents written by older app versions (no syncVersion) are still handled
 * the old way: the newer copy as a whole wins.
 */

const SYNC_VERSION = 2;
const TOMBSTONE_DAYS = 180;

const CLOUD_COLLECTION = 'users';
const CLOUD_DOC = 'wedding';

let _syncEnabled = false;
let _syncing = false;
let _pushTimer = null;
let _lastPushedAt = 0;
let _cloudUpdatedAt = 0;
let _unsubscribe = null;
let _pushPending = false;
let _applyingCloud = false;
let _lastWriteId = null;

// Time of the last local change made while logged in (or of the last synced
// snapshot), per user. Persisted so that edits made offline survive a reload:
// without it the stale cloud copy would win on the next login and overwrite them.
function localTsKey() {
  return 'smw-local-updated-at:' + (currentUser ? currentUser.uid : '');
}
function getLocalUpdatedAt() {
  if (!currentUser) return 0;
  try { return Number(localStorage.getItem(localTsKey())) || 0; } catch (e) { return 0; }
}
function setLocalUpdatedAt(ts) {
  if (!currentUser) return;
  try { localStorage.setItem(localTsKey(), String(ts)); } catch (e) { /* ignore */ }
}

// The account the data on this device belongs to. Without it, logging in with
// a second account on a shared device would upload the first one's guests to it.
const OWNER_KEY = 'smw-data-owner';
function getDataOwner() {
  try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; }
}
function setDataOwner(uid) {
  try { localStorage.setItem(OWNER_KEY, uid); } catch (e) { /* ignore */ }
}

// Removes this device's copy (the cloud copy stays): the local database,
// Firestore's offline cache and the sync bookkeeping in localStorage.
async function wipeLocalData() {
  await dbWipeAll();
  try {
    Object.keys(localStorage).filter(k => k.startsWith('smw-')).forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  await loadAll();
  emit('sync');
  if (typeof renderAll === 'function') renderAll();
  if (typeof updateHeader === 'function') updateHeader();
}

async function clearFirestoreCache() {
  try {
    await firebase.firestore().terminate();
    await firebase.firestore().clearPersistence();
  } catch (e) {
    console.warn('[Sync] clearing the offline cache failed', e);
  }
}

// Pushes a change that is still waiting for its debounce, e.g. before logout.
async function flushCloudPush() {
  if (!_syncEnabled || !currentUser || !_pushTimer) return;
  clearTimeout(_pushTimer);
  _pushTimer = null;
  await pushToCloud();
}

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

/**
 * Firestore ne dozvoljava undefined / NaN / Infinity u dokumentima.
 * JSON round-trip uklanja undefined ključeve i pretvara rupe u arrayima u null.
 */
function sanitizeForFirestore(value) {
  try {
    return JSON.parse(JSON.stringify(value, function (_key, val) {
      if (val === undefined) return undefined; // omit from objects
      if (typeof val === 'number' && !Number.isFinite(val)) return null;
      if (typeof val === 'function') return undefined;
      return val;
    }));
  } catch (e) {
    console.error('[Sync] sanitize failed', e);
    return { updatedAt: Date.now(), settings: {}, tables: [], categories: [], guests: [], rules: [] };
  }
}

// ── Record-by-record merge ───────────────────────────────────────────────────
// A sync state is { records: { tables: [..], .. }, deleted: { tables: { id: ts }, .. } }.

function emptySyncState() {
  const out = { records: {}, deleted: {} };
  SYNCED_STORES.forEach(store => { out.records[store] = []; out.deleted[store] = {}; });
  return out;
}

// For each record the newer change wins, whether it is an edit or a delete.
// On equal times `b` wins when preferB is set (both copies predate syncVersion 2).
function mergeSyncStates(a, b, preferB) {
  const out = emptySyncState();
  const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
  for (const store of SYNCED_STORES) {
    const ra = new Map(((a.records || {})[store] || []).map(r => [r.id, r]));
    const rb = new Map(((b.records || {})[store] || []).map(r => [r.id, r]));
    const da = (a.deleted || {})[store] || {};
    const db = (b.deleted || {})[store] || {};
    const ids = new Set([...ra.keys(), ...rb.keys(), ...Object.keys(da), ...Object.keys(db)]);
    for (const id of ids) {
      const x = ra.get(id), y = rb.get(id);
      let rec = x || y;
      if (x && y) {
        const tx = x.updatedAt || 0, ty = y.updatedAt || 0;
        rec = ty > tx || (ty === tx && preferB) ? y : x;
      }
      const deletedAt = Math.max(da[id] || 0, db[id] || 0);
      if (rec && (rec.updatedAt || 0) > deletedAt) out.records[store].push(rec);
      else if (rec && !deletedAt) out.records[store].push(rec);
      else if (deletedAt > cutoff) out.deleted[store][id] = deletedAt;
    }
  }
  return out;
}

function sameSyncState(a, b) {
  const key = s => JSON.stringify(SYNCED_STORES.map(store => [
    [...(s.records[store] || [])].sort((x, y) => (x.id < y.id ? -1 : 1)),
    Object.keys(s.deleted[store] || {}).sort()
  ]));
  return key(a) === key(b);
}

function fromCloudDoc(data) {
  const out = emptySyncState();
  if (!data) return out;
  out.version = data.syncVersion || 1;
  out.updatedAt = data.updatedAt || 0;
  if (data.settings) out.records.settings = [{ ...data.settings, id: 'main' }];
  ['tables', 'categories', 'guests', 'rules'].forEach(store => { out.records[store] = data[store] || []; });
  SYNCED_STORES.forEach(store => { out.deleted[store] = (data.deleted && data.deleted[store]) || {}; });
  return out;
}

function toCloudDoc(sync) {
  const strip = r => { const c = { ...r }; delete c.satisfied; return c; };
  return sanitizeForFirestore({
    syncVersion: SYNC_VERSION,
    updatedAt: Date.now(),
    settings: sync.records.settings[0] || { id: 'main', weddingTitle: '', monogram: '' },
    tables: sync.records.tables,
    categories: sync.records.categories,
    guests: sync.records.guests,
    rules: sync.records.rules.map(strip),
    deleted: sync.deleted
  });
}

// Brings a merged copy into IndexedDB and the app. Local edits made since the
// merge was computed are newer, so they win again here. Returns true when the
// local data now has something the given copy doesn't (so it should be pushed).
async function applyMergedLocally(target) {
  const result = await dbMergeSync(local => mergeSyncStates(local, target, true));
  if (!result.changed) return !sameSyncState(result.merged, target);
  const repaired = await loadAll();
  emit('sync');
  if (typeof renderAll === 'function') renderAll();
  if (typeof updateHeader === 'function') updateHeader();
  return repaired || !sameSyncState(result.merged, target);
}

/** Primijeni cijeli snapshot iz clouda (dokument starije verzije aplikacije) */
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
  _applyingCloud = true;
  clearTimeout(_pushTimer);
  try {
    await importData(payload);
    _cloudUpdatedAt = data.updatedAt || 0;
    _lastPushedAt = data.updatedAt || 0;
    setLocalUpdatedAt(_lastPushedAt);
  } finally {
    _syncEnabled = wasEnabled;
    _applyingCloud = false;
  }
}

/** Push lokalnog stanja u Firestore (debounce) */
function scheduleCloudPush(delay = 1200) {
  if (!_syncEnabled || !currentUser) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => pushToCloud(), delay);
}

async function pushToCloud() {
  if (!_syncEnabled || !currentUser) return;
  if (_syncing) {
    // A push is in flight — push again once it finishes so this change isn't lost.
    _pushPending = true;
    return;
  }
  if (!navigator.onLine) {
    setSyncStatus('offline');
    return;
  }
  _syncing = true;
  setSyncStatus('syncing');
  try {
    const ref = getUserDocRef(currentUser.uid);
    let merged = null;
    let doc = null;
    // Read the cloud copy and write the merge atomically: if another device
    // writes in between, Firestore retries this with its newer copy.
    await firebase.firestore().runTransaction(async tx => {
      const local = await dbReadSyncState();
      const snap = await tx.get(ref);
      const remote = snap.exists ? fromCloudDoc(snap.data()) : null;
      // An older app version wrote the whole state; the decision which copy
      // wins was made at login (onAuthForSync), so here the local copy does.
      const mergeable = remote && remote.version >= SYNC_VERSION;
      merged = mergeable ? mergeSyncStates(local, remote, false) : local;
      doc = null;
      if (mergeable && sameSyncState(merged, remote)) return; // nothing new to write
      doc = toCloudDoc(merged);
      doc.writeId = crypto.randomUUID();
      tx.set(ref, doc);
    });
    if (doc) {
      _lastWriteId = doc.writeId;
      _lastPushedAt = doc.updatedAt;
      _cloudUpdatedAt = _lastPushedAt;
      if (getLocalUpdatedAt() <= _lastPushedAt) setLocalUpdatedAt(_lastPushedAt);
    }
    // Bring in what the other devices changed.
    if (await applyMergedLocally(merged)) _pushPending = true;
    setSyncStatus('synced');
  } catch (err) {
    console.error('[Sync] push failed', err);
    setSyncStatus('error');
    if (typeof showToast === 'function') {
      var msg = err && err.message ? String(err.message) : 'mrežna greška';
      if (msg.indexOf('undefined') !== -1 || msg.indexOf('invalid data') !== -1) {
        msg = 'Podaci sadrže nepotpuna polja. Pokušaj ponovo nakon osvježavanja.';
      }
      showToast('Sinkronizacija nije uspjela: ' + msg, true);
    }
  } finally {
    _syncing = false;
    if (_pushPending) {
      _pushPending = false;
      scheduleCloudPush(300);
    }
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
    // Data left here by another account is not merged into this one.
    const owner = getDataOwner();
    if (owner && owner !== user.uid) {
      _syncEnabled = false;
      await wipeLocalData();
      _syncEnabled = true;
    }
    setDataOwner(user.uid);

    const cloud = await pullFromCloud();
    const localHasData = !!(state.settings.weddingTitle || state.tables.length || state.guests.length);
    const cloudHasData = !!(cloud && (cloud.settings?.weddingTitle || (cloud.tables && cloud.tables.length) || (cloud.guests && cloud.guests.length)));

    const cloudIsMergeable = cloud && (cloud.syncVersion || 1) >= SYNC_VERSION;

    if (!cloudHasData && localHasData) {
      // Prvi put – upload lokalnih podataka
      await pushToCloud();
    } else if (cloudHasData && cloudIsMergeable) {
      // Merge both ways: the push reads the cloud copy, merges and writes back.
      await pushToCloud();
      if (!localHasData && typeof showToast === 'function') showToast('Podaci preuzeti iz clouda');
    } else if (cloudHasData && !localHasData) {
      // Lokalno prazno – preuzmi cloud
      await applyCloudSnapshot(cloud);
      if (typeof renderAll === 'function') renderAll();
      if (typeof showToast === 'function') showToast('Podaci preuzeti iz clouda');
      await pushToCloud(); // rewrite it in the mergeable format
    } else if (cloudHasData && localHasData) {
      // Document from an older app version: the newer copy wins as a whole,
      // then it is written back in the mergeable format.
      const cloudTs = cloud.updatedAt || 0;
      if (cloudTs > Math.max(_lastPushedAt, getLocalUpdatedAt()) + 2000) {
        await applyCloudSnapshot(cloud);
        if (typeof renderAll === 'function') renderAll();
        if (typeof showToast === 'function') showToast('Sinkronizirano s cloudom');
      }
      await pushToCloud();
    } else {
      setSyncStatus('synced');
    }

    // Real-time listener (druga uređaja / tabovi)
    if (_unsubscribe) _unsubscribe();
    _unsubscribe = getUserDocRef(user.uid).onSnapshot(
      async doc => {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        const data = doc.data();
        if (data.writeId && data.writeId === _lastWriteId) return; // our own push
        if (_syncing) {
          // A push is running; the next one reads this copy and merges it in.
          _pushPending = true;
          return;
        }
        if ((data.syncVersion || 1) >= SYNC_VERSION) {
          // Another device pushed: merge it in, and push back anything newer here.
          _cloudUpdatedAt = data.updatedAt || 0;
          if (await applyMergedLocally(fromCloudDoc(data))) scheduleCloudPush(300);
        } else {
          const ts = data.updatedAt || 0;
          if (ts <= _lastPushedAt || ts <= _cloudUpdatedAt) return;
          _cloudUpdatedAt = ts;
          // An older app version overwrote the document as a whole.
          await applyCloudSnapshot(data);
          if (typeof renderAll === 'function') renderAll();
          if (typeof updateHeader === 'function') updateHeader();
          scheduleCloudPush(300);
        }
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
    synced: 'Sinkronizirano',
    syncing: 'Sinkronizacija…',
    offline: 'Izvan mreže',
    error: 'Greška'
  };
  el.innerHTML = labels[status] ? `${icon('cloud')} ${labels[status]}` : '';
  el.title = labels[status] || '';
  el.style.display = status === 'off' ? 'none' : '';
  // A dot on the Opcije button shows the sync state while the menu is closed.
  const btn = document.getElementById('btn-options');
  if (btn) btn.dataset.sync = status;
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
  window.addEventListener('stateChange', e => {
    // Changes that came from the cloud are not pushed back.
    const type = e.detail && e.detail.type;
    if (type === 'sync' || (type === 'import' && _applyingCloud) || !currentUser) return;
    setLocalUpdatedAt(Date.now());
    if (_syncEnabled) scheduleCloudPush();
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
