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
    return {
      persistent: true,
      get: key => operation('readonly', store => store.get(key)),
      set: (key, value) => operation('readwrite', store => store.put(value, key)),
      claim: key => {
        if (!navigator.locks) throw new Error('This browser cannot safely coordinate workout saves. Open the app in an up-to-date browser.');
        return new Promise((resolve, reject) => {
          void navigator.locks.request(`form-workout:${key}`, { ifAvailable: true }, lock => {
            resolve(!!lock);
            // The browser releases this lock when the document closes. A second tab must reload after acquiring it to read the latest snapshot.
            if (lock) return new Promise(() => {});
          }).catch(reject);
        });
      },
    };
  } catch {
    const data = new Map();
    return { persistent: false, get: async key => structuredClone(data.get(key)), set: async (key, value) => { data.set(key, structuredClone(value)); } };
  }
}
