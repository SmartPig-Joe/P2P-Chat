// utils.js

// HTML 实体转义
export function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 格式化时间 HH:MM
export function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// --- 模拟数据 (REMOVED - No longer used by UI) ---
/*
export const mockUsers = [
    { id: "user1", name: "用户名", avatar: "5865f2", status: "online" },
    { id: "user2", name: "用户B", avatar: "43b581", status: "offline", colorClass: "text-green-400" },
    { id: "user3", name: "用户C", avatar: "f04747", status: "offline", colorClass: "text-red-400" },
    { id: "user4", name: "用户D", avatar: "99aab5", status: "offline", colorClass: "text-discord-text-muted" },
    { id: "admin", name: "管理员", avatar: "f1c40f", status: "offline" },
];
*/

// 根据用户名或ID获取 Tailwind 颜色类（用于消息显示）
// 不再依赖 mockUsers
export function getUserColorClass(userIdOrName) {
    // const user = mockUsers.find(u => u.name === username);
    // if (user && user.colorClass) return user.colorClass;
    const colors = [
        'text-red-400', // Red
        'text-yellow-400', // Yellow
        'text-green-400', // Green
        'text-blue-400', // Blue
        'text-indigo-400', // Indigo
        'text-purple-400', // Purple
        'text-pink-400', // Pink
        'text-teal-400' // Teal
        // Removed white and muted as they don't contrast well consistently
    ];
    // Simple hash function (djb2 variation)
    let hash = 5381;
    const str = String(userIdOrName); // Ensure it's a string
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    const index = Math.abs(hash % colors.length);
    return colors[index];
}

// --- Web Crypto Functions ---

/**
 * Generates an ECDH P-256 key pair for encryption/key agreement.
 * The private key is marked as extractable for storage.
 * @returns {Promise<CryptoKeyPair>} A promise that resolves with the generated key pair { publicKey, privateKey }.
 */
export async function generateEncryptionKeyPair() {
    try {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "ECDH",
                namedCurve: "P-256", // Standard curve for ECDH
            },
            true, // Make the key extractable (important for saving the private key)
            ["deriveKey", "deriveBits"] // Key usages for ECDH
        );
        console.log("ECDH P-256 key pair generated successfully.");
        return keyPair; // Returns an object { publicKey: CryptoKey, privateKey: CryptoKey }
    } catch (error) {
        console.error("Error generating encryption key pair:", error);
        throw error; // Re-throw the error to be handled by the caller
    }
}

// --- Web Crypto Helper Functions ---

/**
 * Exports a CryptoKey (public key) to JWK format.
 * @param {CryptoKey} key The public CryptoKey to export.
 * @returns {Promise<object>} A promise that resolves with the key in JWK format.
 */

/**
 * Imports a public key from JWK format.
 * @param {object} jwk The JWK object representing the public key.
 * @returns {Promise<CryptoKey>} A promise that resolves with the imported CryptoKey object.
 */

/**
 * Derives a shared AES-GCM key using ECDH.
 * @param {CryptoKey} privateKey Your local private ECDH key.
 * @param {CryptoKey} peerPublicKey The peer's public ECDH key.
 * @returns {Promise<CryptoKey>} A promise that resolves with the derived AES-GCM CryptoKey.
 */

/**
 * Encrypts data using AES-GCM with a shared key.
 * @param {CryptoKey} sharedKey The AES-GCM key derived via ECDH.
 * @param {string} plaintext The string data to encrypt.
 * @returns {Promise<{iv: Uint8Array, ciphertext: ArrayBuffer}>} A promise resolving with an object containing the initialization vector (iv) and the ciphertext.
 */

/**
 * Decrypts data using AES-GCM with a shared key.
 * @param {CryptoKey} sharedKey The AES-GCM key derived via ECDH.
 * @param {Uint8Array} iv The initialization vector used during encryption.
 * @param {ArrayBuffer} ciphertext The encrypted data.
 * @returns {Promise<string>} A promise resolving with the decrypted plaintext string.
 */

// You might need other crypto utility functions here later, e.g.,
// - deriveSharedSecret(privateKey, peerPublicKey)
// - encryptWithSharedSecret(sharedKey, data)
// - decryptWithSharedSecret(sharedKey, encryptedData)
// - exportPublicKeyAsJwk(publicKey)

// --- Base64 Conversion Helpers ---

/**
 * Converts an ArrayBuffer to a Base64 string.
 * @param {ArrayBuffer} buffer The buffer to convert.
 * @returns {string} The Base64 encoded string.
 */
export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

/**
 * Converts a Base64 string to an ArrayBuffer.
 * @param {string} base64 The Base64 string to convert.
 * @returns {ArrayBuffer} The resulting ArrayBuffer.
 */
export function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Converts a Uint8Array to a Base64 string.
 * @param {Uint8Array} uint8Array The array to convert.
 * @returns {string} The Base64 encoded string.
 */
export function uint8ArrayToBase64(uint8Array) {
  // Ensure we handle the case where the Uint8Array might be a view on a larger ArrayBuffer correctly
  if (uint8Array.byteLength === uint8Array.buffer.byteLength && uint8Array.byteOffset === 0) {
    return arrayBufferToBase64(uint8Array.buffer);
  } else {
    // Create a new ArrayBuffer from the subarray view if necessary
    const buffer = uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);
    return arrayBufferToBase64(buffer);
  }
}

/**
 * Converts a Base64 string to a Uint8Array.
 * @param {string} base64 The Base64 string to convert.
 * @returns {Uint8Array} The resulting Uint8Array.
 */
export function base64ToUint8Array(base64) {
  const buffer = base64ToArrayBuffer(base64);
  return new Uint8Array(buffer);
}

/**
 * Formats bytes into a human-readable string (KB, MB, GB, etc.).
 * @param {number} bytes The number of bytes.
 * @param {number} [decimals=2] The number of decimal places to display.
 * @returns {string} The formatted string.
 */
export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// (Other functions if needed) 