class EJS_STORAGE {
    constructor(dbName, storeName) {
        this.dbName = dbName;
        this.storeName = storeName;
    }
    addFileToDB(key, add) {
        (async () => {
            if (key === "?EJS_KEYS!") return;
            let keys = await this.get("?EJS_KEYS!");
            if (!keys) keys = [];
            if (add) {
                if (!keys.includes(key)) keys.push(key);
            } else {
                const index = keys.indexOf(key);
                if (index !== -1) keys.splice(index, 1);
            }
            this.put("?EJS_KEYS!", keys);
        })();
    }
    get(key) {
        return new Promise((resolve) => {
            if (!window.indexedDB) return resolve();
            const openRequest = indexedDB.open(this.dbName, 1);
            openRequest.onerror = () => resolve();
            openRequest.onsuccess = () => {
                const db = openRequest.result;
                const transaction = db.transaction([this.storeName], "readwrite");
                const objectStore = transaction.objectStore(this.storeName);
                const request = objectStore.get(key);
                request.onsuccess = () => {
                    resolve(request.result);
                };
                request.onerror = () => resolve();
            };
            openRequest.onupgradeneeded = () => {
                const db = openRequest.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }
    put(key, data) {
        return new Promise((resolve) => {
            if (!window.indexedDB) return resolve();
            const openRequest = indexedDB.open(this.dbName, 1);
            openRequest.onerror = () => {};
            openRequest.onsuccess = () => {
                const db = openRequest.result;
                const transaction = db.transaction([this.storeName], "readwrite");
                const objectStore = transaction.objectStore(this.storeName);
                const request = objectStore.put(data, key);
                request.onerror = () => resolve();
                request.onsuccess = () => {
                    this.addFileToDB(key, true);
                    resolve();
                }
            };
            openRequest.onupgradeneeded = () => {
                const db = openRequest.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }
    remove(key) {
        return new Promise((resolve) => {
            if (!window.indexedDB) return resolve();
            const openRequest = indexedDB.open(this.dbName, 1);
            openRequest.onerror = () => {};
            openRequest.onsuccess = () => {
                const db = openRequest.result;
                const transaction = db.transaction([this.storeName], "readwrite");
                const objectStore = transaction.objectStore(this.storeName);
                const request2 = objectStore.delete(key);
                this.addFileToDB(key, false);
                request2.onsuccess = () => resolve();
                request2.onerror = () => {};
            };
            openRequest.onupgradeneeded = () => {
                const db = openRequest.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }
    async getSizes() {
        if (!window.indexedDB) return {};
        const keys = await this.get("?EJS_KEYS!");
        if (!keys) return {};
        const rv = {};
        for (let i = 0; i < keys.length; i++) {
            const result = await this.get(keys[i]);
            if (!result || !result.data || typeof result.data.byteLength !== "number") continue;
            rv[keys[i]] = result.data.byteLength;
        }
        return rv;
    }
}

class EJS_DUMMYSTORAGE {
    constructor() {}
    addFileToDB() {
        return new Promise(resolve => resolve());
    }
    get() {
        return new Promise(resolve => resolve());
    }
    put() {
        return new Promise(resolve => resolve());
    }
    remove() {
        return new Promise(resolve => resolve());
    }
    getSizes() {
        return new Promise(resolve => resolve({}));
    }
}

window.EJS_STORAGE = EJS_STORAGE;
window.EJS_DUMMYSTORAGE = EJS_DUMMYSTORAGE;
