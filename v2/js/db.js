// IndexedDB storage for surveys (including photo blobs) so nothing is lost
// when the phone is offline or the browser is closed mid-survey.

// Own name so v2 (hosted at /v2/) never shares surveys with v1 on the same site.
const DB_NAME = "vbn-field-survey-v2";
const STORE = "surveys";
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("blockLot", "blockLot");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const putSurvey = (survey) => run("readwrite", (s) => s.put(survey));
export const getSurvey = (id) => run("readonly", (s) => s.get(id));
export const allSurveys = () => run("readonly", (s) => s.getAll());
export const deleteSurvey = (id) => run("readwrite", (s) => s.delete(id));
