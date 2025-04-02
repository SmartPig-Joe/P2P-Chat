// storage.js

const DB_NAME = 'p2pChatDB';
const DB_VERSION = 1;
const STORE_MESSAGES = 'messages';

let db = null; // Variable to hold the database instance

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