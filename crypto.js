// crypto.js
import { ECDH_PARAMS, AES_PARAMS, KEY_USAGE_ECDH, KEY_USAGE_AES } from './constants.js';
import * as state from './state.js';
import { addSystemMessage, updateConnectionStatus } from './ui.js'; // Need ui functions for error/status messages

// Function to reset connection state will be called from connection.js or main.js
// We don't import resetConnection directly here to avoid circular dependency

// Generate ECDH key pair
export async function generateAndStoreKeyPair() {
    try {
        const keyPair = await window.crypto.subtle.generateKey(
            ECDH_PARAMS,
            true, // extractable
            KEY_USAGE_ECDH
        );
        console.log("ECDH key pair generated:", keyPair);
        state.setLocalKeyPair(keyPair);
    } catch (error) {
        console.error("Error generating key pair:", error);
        addSystemMessage("生成密钥对失败。", true);
        // We need to signal the connection logic to reset.
        // This might require throwing an error or returning a failure status.
        throw new Error("Key generation failed"); 
    }
}

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
        state.setSharedKey(derived); // Store the derived key in state
        return derived;
    } catch (error) {
        console.error("Error deriving shared key:", error);
        addSystemMessage("共享密钥派生失败！", true);
        return null;
    }
}

// Encrypt data using the shared AES-GCM key
export async function encryptMessage(key, data) {
    if (!key) throw new Error("Encryption key is not available.");
    try {
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV is recommended for GCM
        // Prepare the data (ensure it's stringified if it's an object)
        const dataToEncrypt = typeof data === 'string' ? data : JSON.stringify(data);
        const encodedData = new TextEncoder().encode(dataToEncrypt);

        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: AES_PARAMS.name,
                iv: iv
            },
            key,           // The AES-GCM key
            encodedData    // Data to encrypt as ArrayBuffer
        );

        // Return IV and ciphertext, often base64 encoded for transmission, but raw buffers are fine for DataChannel
        return {
            iv: Array.from(iv), // Convert IV to a regular array for JSON serialization
            ciphertext: Array.from(new Uint8Array(ciphertext)) // Convert ciphertext to a regular array
        };
    } catch (error) {
        console.error("Encryption error:", error);
        throw error; // Re-throw to be handled by the caller
    }
}

// Decrypt data using the shared AES-GCM key
export async function decryptMessage(key, encryptedData) {
    if (!key) throw new Error("Decryption key is not available.");
    if (!encryptedData || !encryptedData.iv || !encryptedData.ciphertext) {
        throw new Error("Invalid encrypted data format for decryption.");
    }
    try {
        const iv = new Uint8Array(encryptedData.iv); // Convert array back to Uint8Array
        const ciphertext = new Uint8Array(encryptedData.ciphertext); // Convert array back to Uint8Array

        const decrypted = await window.crypto.subtle.decrypt(
            {
                name: AES_PARAMS.name,
                iv: iv
            },
            key,           // The AES-GCM key
            ciphertext     // The ArrayBuffer containing the ciphertext
        );

        // Decode the decrypted ArrayBuffer back to a string
        const decodedData = new TextDecoder().decode(decrypted);

        // Try to parse if it looks like JSON, otherwise return the raw string
        try {
            return JSON.parse(decodedData);
        } catch (e) {
            console.warn("Decrypted data is not valid JSON, returning as string.");
            return decodedData; // Return as plain text if not JSON
        }
    } catch (error) {
        console.error("Decryption error:", error);
        // More specific error handling could be done here (e.g., check for AuthenticationError)
        throw new Error("Decryption failed. Message may be corrupted or key mismatch."); // Re-throw
    }
} 