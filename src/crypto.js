// crypto.js
import { ECDH_PARAMS, AES_PARAMS, KEY_USAGE_ECDH, KEY_USAGE_AES } from './constants.js';
import * as state from './state.js';
import { addSystemMessage } from '../ui/index.js'; // Path relative to root -> Now relative to src/
import * as storage from './storage.js'; // Import storage functions
import { generateEncryptionKeyPair } from './utils.js'; // Import key generation utility

// Function to reset connection state will be called from connection.js or main.js
// We don't import resetConnection directly here to avoid circular dependency

// --- NEW: Initialization Function ---
/**
 * Initializes the cryptographic module by loading an existing key pair
 * or generating a new one if none is found. Stores the key pair in the state.
 * Throws an error if initialization fails critically (cannot load or generate keys).
 */
export async function initializeCryptography() {
    console.log("Initializing cryptography...");
    let keyPair = null;
    try {
        // 1. Try loading existing key pair
        keyPair = await storage.loadKeyPair();
        if (keyPair) {
            console.log("Existing key pair loaded successfully.");
        } else {
            // 2. If no key pair loaded, generate a new one
            console.log("No existing key pair found. Generating a new one...");
            keyPair = await generateEncryptionKeyPair(); // Use the function from utils.js
            if (keyPair) {
                console.log("New key pair generated.");
                // 3. Save the newly generated key pair
                const saved = await storage.saveKeyPair(keyPair);
                if (saved) {
                    console.log("New key pair saved successfully.");
                } else {
                    console.warn("Failed to save the newly generated key pair. Proceeding without saving.");
                    // Decide if this is a critical failure or just a warning
                }
            } else {
                 // This case should ideally be handled within generateEncryptionKeyPair by throwing
                 console.error("Key pair generation returned null/undefined.");
                 throw new Error("Key pair generation failed.");
            }
        }

        // 4. Store the loaded or generated key pair in the state
        if (keyPair) {
            state.setLocalKeyPair(keyPair);
            console.log("Local key pair set in application state.");
        } else {
             // This should not happen if loading/generation logic is correct and throws errors
             throw new Error("Failed to obtain a valid key pair during initialization.");
        }

    } catch (error) {
        console.error("Cryptography initialization failed:", error);
        addSystemMessage("错误：无法初始化加密模块。安全连接将不可用。", true);
        // Re-throw the error to signal failure to the calling function (e.g., initializeApp)
        throw error;
    }
}

// --- Key Management ---

// Export public key in JWK format
export async function exportPublicKey(key) {
    if (!key) return null;
    try {
        const exported = await window.crypto.subtle.exportKey(
            "jwk",
            key
        );
        return exported;
    } catch (error) {
        console.error("Error exporting public key:", error);
        return null;
    }
}

// Import peer's public key from JWK format
export async function importPublicKey(jwk) {
    if (!jwk) return null;
    try {
        const importedKey = await window.crypto.subtle.importKey(
            "jwk",
            jwk,
            ECDH_PARAMS,
            true, // extractable (though not strictly necessary for ECDH public key)
            []    // no key usage required for public key import in ECDH
        );
        console.log("Peer public key imported successfully.");
        return importedKey;
    } catch (error) {
        console.error("Error importing public key:", error);
        return null;
    }
}

// Derive shared AES key using local private key and peer public key
export async function deriveSharedKey(localPrivateKey, remotePublicKey) {
    if (!localPrivateKey || !remotePublicKey) {
        console.error("Cannot derive shared key: Missing local private key or peer public key.");
        return null;
    }
    try {
        const derived = await window.crypto.subtle.deriveKey(
            {
                name: ECDH_PARAMS.name,
                public: remotePublicKey // Peer's public key
            },
            localPrivateKey,       // Your private key
            AES_PARAMS,            // Desired algorithm for the derived key (AES-GCM)
            true,                  // Extractable (usually true for symmetric keys)
            KEY_USAGE_AES          // Key usages for the derived AES key
        );
        console.log("Shared AES key derived:", derived);
        return derived;
    } catch (error) {
        console.error("Error deriving shared key:", error);
        addSystemMessage("共享密钥派生失败！", true);
        return null;
    }
}

// --- Encryption/Decryption --- (Use peerId to get correct key from state.peerKeys)

// Encrypt data using the shared AES-GCM key for a specific peer
export async function encryptMessage(peerId, text) {
    // Get keys for the specific peer
    const keys = state.getPeerKeys(peerId);
    if (!keys || !keys.sharedKey) {
        throw new Error(`Encryption key not available for peer ${peerId}.`);
    }
    if (!text) throw new Error("Cannot encrypt empty message.");

    try {
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV is recommended for GCM
        const encodedData = new TextEncoder().encode(text);

        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: AES_PARAMS.name,
                iv: iv
            },
            keys.sharedKey, // Use the peer-specific key
            encodedData
        );

        // Return IV and ciphertext as arrays for JSON serialization
        return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(ciphertext))
        };
    } catch (error) {
        console.error(`Encryption error for peer ${peerId}:`, error);
        throw error; // Re-throw
    }
}

// Decrypt data using the shared AES-GCM key for a specific peer
export async function decryptMessage(peerId, encryptedPayload) {
    // Get keys for the specific peer
    const keys = state.getPeerKeys(peerId);
    if (!keys || !keys.sharedKey) {
        throw new Error(`Decryption key not available for peer ${peerId}.`);
    }
    if (!encryptedPayload || !encryptedPayload.iv || !encryptedPayload.ciphertext) {
        throw new Error("Invalid encrypted data format for decryption.");
    }
    try {
        const iv = new Uint8Array(encryptedPayload.iv);
        const ciphertext = new Uint8Array(encryptedPayload.ciphertext);

        const decrypted = await window.crypto.subtle.decrypt(
            {
                name: AES_PARAMS.name,
                iv: iv
            },
            keys.sharedKey, // Use the peer-specific key
            ciphertext
        );

        const decodedData = new TextDecoder().decode(decrypted);
        return decodedData; // Return the decrypted string directly

    } catch (error) {
        console.error(`Decryption error for peer ${peerId}:`, error);
        throw new Error(`Decryption failed for peer ${peerId}. Message may be corrupted or key mismatch.`);
    }
}

// --- Key Handling --- (New function to handle incoming public key)
/**
 * Imports the peer's public key and derives the shared secret for a specific peer.
 * Stores the peer's public key and the derived shared key in the state for that peer.
 * @param {string} peerId The ID of the peer whose public key is being handled.
 * @param {JsonWebKey} peerPublicKeyJwk The peer's public key in JWK format.
 */
export async function handlePublicKey(peerId, peerPublicKeyJwk) {
    if (!state.localKeyPair || !state.localKeyPair.privateKey) {
        console.error("Cannot handle peer public key: Local key pair not available.");
        // Potentially reset connection or show error?
        return;
    }
    console.log(`Handling received public key for peer ${peerId}...`);
    try {
        const remotePublicKey = await importPublicKey(peerPublicKeyJwk);
        if (!remotePublicKey) {
            throw new Error(`Failed to import peer public key for ${peerId}.`);
        }

        // Derive the shared key
        const sharedKey = await deriveSharedKey(state.localKeyPair.privateKey, remotePublicKey);
        if (!sharedKey) {
             throw new Error(`Failed to derive shared key for ${peerId}.`);
        }

        // Store both keys in the state map for this peer
        state.setPeerKeys(peerId, { sharedKey: sharedKey, peerPublicKey: remotePublicKey });

        console.log(`Shared key derived and stored successfully for peer ${peerId}.`);
        // Potentially trigger UI update or other logic now that secure channel is ready
        const contacts = state.getContacts();
        addSystemMessage(`与 ${contacts[peerId]?.name || peerId} 的端到端加密已建立。`, peerId);

    } catch (error) {
        console.error(`Error handling peer public key for ${peerId}:`, error);
        const contacts = state.getContacts();
        addSystemMessage(`处理 ${contacts[peerId]?.name || peerId} 的公钥并建立安全连接时出错。`, peerId, true);
        // Consider resetting the connection here if key exchange fails
        // connection.resetPeerConnection(peerId); // Example call if connection module was imported
    }
} 