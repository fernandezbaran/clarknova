// db.js — capa de persistencia IndexedDB.
// Stores:
//   fanzines : documentos completos (páginas, capas, ajustes)
//   assets   : blobs binarios (imágenes) referenciados por id desde las capas

const DB_NAME = 'fanzine-maker';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('fanzines')) {
        db.createObjectStore('fanzines', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- Fanzines ----------------------------------------------------------
export function getAllFanzines() {
  return tx('fanzines', 'readonly', (store) => reqAsPromise(store.getAll()));
}

export function getFanzine(id) {
  return tx('fanzines', 'readonly', (store) => reqAsPromise(store.get(id)));
}

export function putFanzine(doc) {
  return tx('fanzines', 'readwrite', (store) => store.put(doc));
}

export function deleteFanzine(id) {
  return tx('fanzines', 'readwrite', (store) => store.delete(id));
}

// ---- Assets ------------------------------------------------------------
export function getAsset(id) {
  return tx('assets', 'readonly', (store) => reqAsPromise(store.get(id)));
}

export function putAsset(asset) {
  return tx('assets', 'readwrite', (store) => store.put(asset));
}

export function deleteAsset(id) {
  return tx('assets', 'readwrite', (store) => store.delete(id));
}

export function getAllAssetIds() {
  return tx('assets', 'readonly', (store) => reqAsPromise(store.getAllKeys()));
}
