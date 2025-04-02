// storage.js

const DB_NAME = 'p2pChatDB';
const DB_VERSION = 1;
const STORE_MESSAGES = 'messages';

let db = null; // Variable to hold the database instance

const KEYPAIR_STORAGE_KEY = 'user_crypto_keypair';

/**
 * Initializes the IndexedDB database.
 * Creates the object store if it doesn't exist.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the DB instance.
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            // Return existing instance if already initialized
            return resolve(db);
        }

        console.log(`Opening database ${DB_NAME} version ${DB_VERSION}...`);
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Database error:", event.target.error);
            reject(`Database error: ${event.target.error}`);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log(`Database ${DB_NAME} opened successfully.`);
            // Resolve with the database instance
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            console.log(`Upgrading database ${DB_NAME} to version ${DB_VERSION}...`);
            const tempDb = event.target.result;

            // Create object store for messages
            if (!tempDb.objectStoreNames.contains(STORE_MESSAGES)) {
                console.log(`Creating object store: ${STORE_MESSAGES}`);
                // Use autoIncrementing key
                const messageStore = tempDb.createObjectStore(STORE_MESSAGES, { keyPath: 'id', autoIncrement: true });

                // Create indexes for efficient querying
                // Index by timestamp to sort messages chronologically
                messageStore.createIndex('timestamp', 'timestamp', { unique: false });
                // Index by the combination of local and remote user IDs to fetch messages for a specific chat
                // We might store messages based on who the peer was during that message exchange
                messageStore.createIndex('peerId', 'peerId', { unique: false });
                 // Add other relevant indexes if needed, e.g., 'isLocal'
                messageStore.createIndex('isLocal', 'isLocal', { unique: false });

                console.log(`Object store ${STORE_MESSAGES} created with indexes.`);
            } else {
                 console.log(`Object store ${STORE_MESSAGES} already exists.`);
            }
            // Note: The onsuccess event will fire after onupgradeneeded completes.
            // We don't resolve the promise here, but in the onsuccess handler.
        };
    });
}

/**
 * Adds a message object to the IndexedDB.
 * @param {object} messageData - The message object to store.
 * Should include properties like: text, timestamp, peerId, isLocal, type.
 * @returns {Promise<number>} A promise that resolves with the ID of the added message.
 */
export function addMessage(messageData) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("Database not initialized. Call initDB() first.");
            return reject("Database not initialized.");
        }
        if (!messageData || !messageData.timestamp || !messageData.peerId) {
             console.error("Invalid message data provided to addMessage:", messageData);
             return reject("Invalid message data: missing required fields (timestamp, peerId).");
        }

        // Start a read-write transaction
        const transaction = db.transaction([STORE_MESSAGES], 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);

        // Add the message data
        const request = store.add(messageData);

        request.onsuccess = (event) => {
            // event.target.result contains the key of the added item
            // console.log('Message added successfully with ID:', event.target.result);
            resolve(event.target.result); // Resolve with the new message ID
        };

        request.onerror = (event) => {
            console.error("Error adding message:", event.target.error);
            reject(`Error adding message: ${event.target.error}`);
        };

        transaction.onerror = (event) => {
            console.error("Transaction error adding message:", event.target.error);
            reject(`Transaction error: ${event.target.error}`);
        };
        // transaction.oncomplete = () => { // Optional: log completion
        //     console.log("Add message transaction completed.");
        // };
    });
}

/**
 * Retrieves all messages for a specific peer, sorted by timestamp.
 * @param {string} peerId - The ID of the remote user.
 * @returns {Promise<Array<object>>} A promise that resolves with an array of message objects.
 */
export function getMessages(peerId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("Database not initialized. Call initDB() first.");
            return reject("Database not initialized.");
        }
        if (!peerId) {
            console.error("peerId is required for getMessages");
            return reject("peerId is required.");
        }

        // Start a read-only transaction
        const transaction = db.transaction([STORE_MESSAGES], 'readonly');
        const store = transaction.objectStore(STORE_MESSAGES);
        // Get the index to query by peerId
        const index = store.index('peerId');

        // Use getAll() with the peerId key to retrieve all matching records
        const request = index.getAll(peerId);

        request.onsuccess = (event) => {
            const messages = event.target.result;
            // Sort messages by timestamp in ascending order (should already be somewhat sorted by insertion potentially)
            messages.sort((a, b) => a.timestamp - b.timestamp);
            // console.log(`Retrieved ${messages.length} messages for peer ${peerId}`);
            resolve(messages);
        };

        request.onerror = (event) => {
            console.error(`Error getting messages for peer ${peerId}:`, event.target.error);
            reject(`Error getting messages: ${event.target.error}`);
        };

         transaction.onerror = (event) => {
            console.error("Transaction error getting messages:", event.target.error);
            reject(`Transaction error: ${event.target.error}`);
        };
        // transaction.oncomplete = () => { // Optional: log completion
        //     console.log("Get messages transaction completed.");
        // };
    });
}

/**
 * Retrieves a unique list of all peer IDs from the message store.
 * @returns {Promise<Array<string>>} A promise that resolves with an array of unique peer IDs.
 */
export function getAllPeerIds() {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("Database not initialized. Call initDB() first.");
            return reject("Database not initialized.");
        }

        const transaction = db.transaction([STORE_MESSAGES], 'readonly');
        const store = transaction.objectStore(STORE_MESSAGES);
        const index = store.index('peerId'); // Use the peerId index
        const uniquePeerIds = new Set();

        // Use a cursor to iterate over the index keys (peer IDs)
        const cursorRequest = index.openKeyCursor(null, 'nextunique'); // 'nextunique' efficiently gets unique keys

        cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                uniquePeerIds.add(cursor.key); // Add the unique peer ID
                cursor.continue();
            } else {
                // Cursor finished, resolve with the array of unique IDs
                console.log("Retrieved unique peer IDs:", Array.from(uniquePeerIds));
                resolve(Array.from(uniquePeerIds));
            }
        };

        cursorRequest.onerror = (event) => {
            console.error("Error getting unique peer IDs:", event.target.error);
            reject(`Error getting peer IDs: ${event.target.error}`);
        };

        transaction.onerror = (event) => {
            console.error("Transaction error getting peer IDs:", event.target.error);
            reject(`Transaction error: ${event.target.error}`);
        };
    });
}

/**
 * Deletes all messages associated with a specific peer ID from the IndexedDB.
 * @param {string} peerId - The ID of the peer whose messages should be deleted.
 * @returns {Promise<void>} A promise that resolves when deletion is complete or rejects on error.
 */
export function deleteMessagesForPeer(peerId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("Database not initialized. Call initDB() first.");
            return reject("Database not initialized.");
        }
        if (!peerId) {
            console.error("peerId is required for deleteMessagesForPeer");
            return reject("peerId is required.");
        }

        console.log(`Attempting to delete messages for peer: ${peerId}`);

        // Start a read-write transaction
        const transaction = db.transaction([STORE_MESSAGES], 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);
        // Get the index to query by peerId
        const index = store.index('peerId');

        // Open a cursor over the index for the specified peerId
        const request = index.openCursor(IDBKeyRange.only(peerId));
        let deleteCount = 0;

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                // Delete the record found by the cursor
                const deleteRequest = cursor.delete();
                deleteRequest.onsuccess = () => {
                    deleteCount++;
                };
                deleteRequest.onerror = (e) => {
                     console.error(`Error deleting message with key ${cursor.primaryKey} for peer ${peerId}:`, e.target.error);
                     // Continue trying to delete other messages
                };
                cursor.continue(); // Move to the next record matching the peerId
            } else {
                // No more entries matching the peerId
                console.log(`Finished deleting messages for peer ${peerId}. Total deleted: ${deleteCount}`);
                resolve(); // Deletion process completed (successfully or with individual errors logged)
            }
        };

        request.onerror = (event) => {
            console.error(`Error opening cursor to delete messages for peer ${peerId}:`, event.target.error);
            reject(`Error opening cursor: ${event.target.error}`);
        };

        transaction.onerror = (event) => {
            console.error(`Transaction error deleting messages for peer ${peerId}:`, event.target.error);
            // Note: The transaction might have already failed before resolving/rejecting the main promise
            // If the transaction fails, individual delete errors might not be the root cause.
            reject(`Transaction error: ${event.target.error}`);
        };
        transaction.oncomplete = () => {
             // This might fire before the main promise resolves if cursor iteration finishes first
             console.log(`Delete messages transaction completed for peer ${peerId}.`);
             // Resolve here might be too early if cursor.delete() is async in a way that outlives the transaction?
             // It's generally safer to resolve when the cursor iteration completes (in the else block of cursor.onsuccess)
        };
    });
}

export async function saveKeyPair(keyPair) {
  try {
    // 检查 keyPair 是否有效
    if (!keyPair || !keyPair.publicKey || !keyPair.privateKey) {
      console.error("保存失败：无效的密钥对对象");
      return false;
    }
    // 导出公钥和私钥为 JWK 格式
    const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey); // 确保私钥是可导出的

    // 存储到 localStorage
    localStorage.setItem(KEYPAIR_STORAGE_KEY, JSON.stringify({
      publicKey: publicKeyJwk,
      privateKey: privateKeyJwk
    }));
    console.log("密钥对已保存到 localStorage");
    return true;
  } catch (error) {
    console.error("保存密钥对时出错:", error); // **添加错误日志**
    return false;
  }
}

export async function loadKeyPair() {
  try {
    const storedKeyPair = localStorage.getItem(KEYPAIR_STORAGE_KEY);
    if (!storedKeyPair) {
      console.log("未找到存储的密钥对");
      return null;
    }

    const keyPairJwk = JSON.parse(storedKeyPair);

    // 检查 JWK 数据是否存在
    if (!keyPairJwk || !keyPairJwk.publicKey || !keyPairJwk.privateKey) {
        console.error("加载失败：存储的 JWK 数据无效");
        localStorage.removeItem(KEYPAIR_STORAGE_KEY); // 清理无效数据
        return null;
    }

    // 导入公钥和私钥
    // **仔细检查这里的参数是否与生成/导出时一致**
    const publicKey = await window.crypto.subtle.importKey(
      'jwk',
      keyPairJwk.publicKey,
      { name: 'ECDH', namedCurve: 'P-256' }, // **确保算法和曲线匹配**
      true, // 可导出性
      [] // 公钥用途通常为空
    );
    const privateKey = await window.crypto.subtle.importKey(
      'jwk',
      keyPairJwk.privateKey,
      { name: 'ECDH', namedCurve: 'P-256' }, // **确保算法和曲线匹配**
      true, // 可导出性
      ['deriveKey', 'deriveBits'] // **确保用途与实际使用匹配**
    );

    console.log("密钥对已从 localStorage 加载");
    return { publicKey, privateKey };
  } catch (error) {
    console.error("加载密钥对时出错:", error); // **添加错误日志**
    // 加载失败时可能需要清除无效的存储项
    localStorage.removeItem(KEYPAIR_STORAGE_KEY);
    return null;
  }
} 