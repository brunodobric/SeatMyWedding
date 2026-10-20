const DB_NAME = 'weddingDB';
const DB_VERSION = 2;
const STORES = ['settings', 'tables', 'categories', 'guests', 'rules', 'deleted'];

// Stores that sync between devices. Every write stamps the record with
// updatedAt, and every delete leaves a tombstone in 'deleted'
// ({ id: 'guests:<id>', store, recordId, deletedAt }), so that a sync can merge
// two devices record by record instead of one copy overwriting the other.
const SYNCED_STORES = ['settings', 'tables', 'categories', 'guests', 'rules'];
const isSynced = store => SYNCED_STORES.includes(store);
const tombstoneId = (store, id) => store + ':' + id;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = e => {
      _db = e.target.result;
      // Let a newer version of the app (another tab) upgrade the database.
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = e => reject(e.target.error);
  });
}

async function dbGet(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(store, item) {
  return dbPutAll(store, [item]);
}

async function dbDelete(store, id) {
  return dbDeleteAll(store, [id]);
}

// Removes every record; synced records leave tombstones (a restored backup
// replaces them, so another device must not bring them back).
async function dbClear(store) {
  const db = await openDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(isSynced(store) ? [store, 'deleted'] : [store], 'readwrite');
    const os = tx.objectStore(store);
    if (isSynced(store)) {
      const req = os.getAllKeys();
      req.onsuccess = () => {
        const del = tx.objectStore('deleted');
        req.result.forEach(id => del.put({ id: tombstoneId(store, id), store, recordId: id, deletedAt: now }));
        os.clear();
      };
    } else {
      os.clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Writes records. Synced stores get a fresh updatedAt (the caller's object is
// left as is) and lose any tombstone, e.g. when a delete is undone.
async function dbPutAll(store, items) {
  if (!items.length) return;
  const db = await openDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const synced = isSynced(store);
    const tx = db.transaction(synced ? [store, 'deleted'] : [store], 'readwrite');
    const os = tx.objectStore(store);
    const del = synced ? tx.objectStore('deleted') : null;
    items.forEach(item => {
      if (synced) {
        os.put({ ...item, updatedAt: now });
        del.delete(tombstoneId(store, item.id));
      } else {
        os.put(item);
      }
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDeleteAll(store, ids) {
  if (!ids.length) return;
  const db = await openDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const synced = isSynced(store);
    const tx = db.transaction(synced ? [store, 'deleted'] : [store], 'readwrite');
    const os = tx.objectStore(store);
    const del = synced ? tx.objectStore('deleted') : null;
    ids.forEach(id => {
      os.delete(id);
      if (synced) del.put({ id: tombstoneId(store, id), store, recordId: id, deletedAt: now });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Sync helpers: raw access that keeps the timestamps as they are ───────────

// { records: { tables: [..], ... }, deleted: { tables: { id: ts }, ... } }
async function dbReadSyncState() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readonly');
    const out = { records: {}, deleted: {} };
    SYNCED_STORES.forEach(store => {
      out.deleted[store] = {};
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => { out.records[store] = req.result; };
    });
    const req = tx.objectStore('deleted').getAll();
    req.onsuccess = () => {
      req.result.forEach(t => { if (out.deleted[t.store]) out.deleted[t.store][t.recordId] = t.deletedAt; });
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

// Merges a sync state into the local database in one transaction, so a local
// edit can't slip in between reading and writing. merge(local) must be
// synchronous and return the merged state; only records that differ are
// written, without re-stamping them. Resolves to { merged, changed }.
async function dbMergeSync(merge) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    const local = { records: {}, deleted: {} };
    let pending = SYNCED_STORES.length + 1;
    let result = null;
    const step = () => {
      if (--pending) return;
      const merged = merge(local);
      let changed = false;
      SYNCED_STORES.forEach(store => {
        const os = tx.objectStore(store);
        const before = new Map(local.records[store].map(r => [r.id, JSON.stringify(r)]));
        const keep = new Set();
        merged.records[store].forEach(r => {
          keep.add(r.id);
          if (before.get(r.id) !== JSON.stringify(r)) { os.put(r); changed = true; }
        });
        before.forEach((_, id) => { if (!keep.has(id)) { os.delete(id); changed = true; } });
      });
      const del = tx.objectStore('deleted');
      del.clear();
      SYNCED_STORES.forEach(store => {
        Object.entries(merged.deleted[store] || {}).forEach(([recordId, deletedAt]) =>
          del.put({ id: tombstoneId(store, recordId), store, recordId, deletedAt }));
      });
      result = { merged, changed };
    };
    SYNCED_STORES.forEach(store => {
      local.deleted[store] = {};
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => { local.records[store] = req.result; step(); };
    });
    const req = tx.objectStore('deleted').getAll();
    req.onsuccess = () => {
      req.result.forEach(t => { if (local.deleted[t.store]) local.deleted[t.store][t.recordId] = t.deletedAt; });
      step();
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Sync merge aborted'));
  });
}
