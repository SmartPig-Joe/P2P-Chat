// Crypto Constants
export const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
export const AES_PARAMS = { name: 'AES-GCM', length: 256 };
export const KEY_USAGE_ECDH = ['deriveKey', 'deriveBits'];
export const KEY_USAGE_AES = ['encrypt', 'decrypt'];

// --- Crypto Functions ---

/**
 * Generates a new ECDH key pair.
 * @returns {Promise<CryptoKeyPair>}
 */
export async function generateKeyPair() {
    try {
        const keyPair = await window.crypto.subtle.generateKey(
            ECDH_PARAMS,
            true,
            KEY_USAGE_ECDH
        );
        console.log("ECDH key pair generated:", keyPair);
        return keyPair;
    } catch (error) {
        console.error("Error generating key pair:", error);
        // Consider throwing the error or returning null/undefined based on desired error handling
        throw new Error("Failed to generate key pair.");
    }
}

/**
 * Exports a public key to JWK format.
 * @param {CryptoKey} key - The public CryptoKey to export.
 * @returns {Promise<JsonWebKey | null>}
 */
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

/**
 * Imports a public key from JWK format.
 * @param {JsonWebKey} jwk - The JWK representation of the public key.
 * @returns {Promise<CryptoKey | null>}
 */
export async function importPublicKey(jwk) {
    if (!jwk) return null;
    try {
        const importedKey = await window.crypto.subtle.importKey(
            "jwk",
            jwk,
            ECDH_PARAMS,
            true, // extractable parameter should be true for ECDH public keys
            [] // public keys have empty key usage
        );
        console.log("Peer public key imported successfully.");
        return importedKey;
    } catch (error) {
        console.error("Error importing public key:", error);
        return null;
    }
}

/**
 * Derives a shared AES-GCM key using ECDH.
 * @param {CryptoKey} localPrivateKey - The local private key.
 * @param {CryptoKey} peerPublicKey - The peer's public key.
 * @returns {Promise<CryptoKey | null>}
 */
export async function deriveSharedKey(localPrivateKey, peerPublicKey) {
    if (!localPrivateKey || !peerPublicKey) return null;
    try {
        const derived = await window.crypto.subtle.deriveKey(
            {
                name: ECDH_PARAMS.name,
                public: peerPublicKey
            },
            localPrivateKey,
            AES_PARAMS,
            true, // Shared key should be extractable if needed, true for general use
            KEY_USAGE_AES
        );
        console.log("Shared AES key derived:", derived);
        return derived;
    } catch (error) {
        console.error("Error deriving shared key:", error);
        return null;
    }
}

/**
 * Encrypts data using AES-GCM.
 * @param {CryptoKey} key - The AES-GCM key.
 * @param {any} data - The data to encrypt (will be JSON.stringified).
 * @returns {Promise<{iv: number[], ciphertext: number[]}>}
 */
export async function encryptMessage(key, data) {
    if (!key) throw new Error("Encryption key is not available.");
    try {
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12 bytes IV for AES-GCM
        const encodedData = new TextEncoder().encode(JSON.stringify(data));

        const ciphertext = await window.crypto.subtle.encrypt(
            { name: AES_PARAMS.name, iv: iv },
            key,
            encodedData
        );

        // Convert IV and ciphertext to arrays of numbers for JSON serialization
        return {
            iv: Array.from(iv),
            ciphertext: Array.from(new Uint8Array(ciphertext))
        };
    } catch (error) {
        console.error("Encryption error:", error);
        throw error; // Re-throw the error for the caller to handle
    }
}

/**
 * Decrypts data using AES-GCM.
 * @param {CryptoKey} key - The AES-GCM key.
 * @param {{iv: number[], ciphertext: number[]}} encryptedData - The encrypted data object.
 * @returns {Promise<any>}
 */
export async function decryptMessage(key, encryptedData) {
    if (!key) throw new Error("Decryption key is not available.");
    if (!encryptedData || !encryptedData.iv || !encryptedData.ciphertext) {
        throw new Error("Invalid encrypted data format.");
    }

    try {
        // Convert arrays of numbers back to Uint8Array
        const iv = new Uint8Array(encryptedData.iv);
        const ciphertext = new Uint8Array(encryptedData.ciphertext);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: AES_PARAMS.name, iv: iv },
            key,
            ciphertext
        );

        const decodedData = new TextDecoder().decode(decrypted);
        return JSON.parse(decodedData);
    } catch (error) {
        console.error("Decryption error:", error);
        // Provide a more specific error message if possible
        throw new Error("Decryption failed. Key might be incorrect or data corrupted.");
    }
} 