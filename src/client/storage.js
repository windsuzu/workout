export async function openStorage() {
  try {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('form-workout', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('data');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const operation = (mode, run) => new Promise((resolve, reject) => {
      const transaction = database.transaction('data', mode), request = run(transaction.objectStore('data'));
      transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
    return { persistent: true, get: key => operation('readonly', store => store.get(key)), set: (key, value) => operation('readwrite', store => store.put(value, key)) };
  } catch {
    const data = new Map();
    return { persistent: false, get: async key => structuredClone(data.get(key)), set: async (key, value) => { data.set(key, structuredClone(value)); } };
  }
}
