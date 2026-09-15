/**
 * IndexedDB persistence layer for MapHarvest
 * Stores jobs and large batches of scraped rows safely without chrome.storage quota limits.
 */

const DB_NAME = 'MapHarvestDB';
const DB_VERSION = 1;

let dbInstance = null;

export function openDatabase() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store: jobs
      if (!db.objectStoreNames.contains('jobs')) {
        const jobsStore = db.createObjectStore('jobs', { keyPath: 'id', autoIncrement: true });
        jobsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Store: rows
      if (!db.objectStoreNames.contains('rows')) {
        const rowsStore = db.createObjectStore('rows', { keyPath: 'id', autoIncrement: true });
        rowsStore.createIndex('jobId', 'jobId', { unique: false });
        rowsStore.createIndex('placeId', 'placeId', { unique: false });
        rowsStore.createIndex('job_place', ['jobId', 'placeId'], { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[MapHarvest DB] Error opening database:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Creates a new scraping job record
 */
export async function createJob(query, options = {}) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs'], 'readwrite');
    const store = tx.objectStore('jobs');
    const job = {
      query,
      options,
      status: 'running',
      collectedCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const req = store.add(job);
    req.onsuccess = () => {
      job.id = req.result;
      resolve(job);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Updates a job record
 */
export async function updateJob(jobId, updates) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs'], 'readwrite');
    const store = tx.objectStore('jobs');
    const getReq = store.get(jobId);

    getReq.onsuccess = () => {
      if (!getReq.result) return resolve(null);
      const updated = {
        ...getReq.result,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      const putReq = store.put(updated);
      putReq.onsuccess = () => resolve(updated);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Saves a batch of rows for a job
 */
export async function saveRowsBatch(jobId, rows) {
  if (!rows || rows.length === 0) return 0;
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['rows'], 'readwrite');
    const store = tx.objectStore('rows');

    for (const row of rows) {
      store.add({
        ...row,
        jobId
      });
    }

    tx.oncomplete = () => resolve(rows.length);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Fetches all rows for a specific job
 */
export async function getRowsForJob(jobId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['rows'], 'readonly');
    const store = tx.objectStore('rows');
    const index = store.index('jobId');
    const req = index.getAll(jobId);

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Fetches recent jobs (default last 10)
 */
export async function getRecentJobs(limit = 10) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs'], 'readonly');
    const store = tx.objectStore('jobs');
    const req = store.getAll();

    req.onsuccess = () => {
      const jobs = req.result || [];
      jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(jobs.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Fetches all jobs from IndexedDB (alias for full history)
 */
export async function getAllJobs() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs'], 'readonly');
    const store = tx.objectStore('jobs');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

