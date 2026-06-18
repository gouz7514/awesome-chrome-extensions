// background.js
// Service worker for Browser Memory extension

const DB_NAME = 'browserMemoryDB';
const STORE_NAME = 'documents';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

async function saveDocument(doc) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(doc);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getAllDocuments() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const result = request.result || [];
      db.close();
      resolve(result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'save') {
    saveDocument(msg.payload).then(() => {
      sendResponse({ status: 'saved' });
    });
    return true; // indicate async response
  }
  if (msg.type === 'fetchAll') {
    getAllDocuments().then((docs) => {
      sendResponse({ docs });
    });
    return true; // indicate async response
  }
});
