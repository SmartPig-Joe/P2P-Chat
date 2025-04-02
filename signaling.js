// --- Signaling State ---
let ws = null;
const signalingServerUrl = 'wss://signal.smartpig.top/ws'; // TODO: Make this configurable

/**
 * Establishes WebSocket connection and sets up handlers.
 * @param {object} config - Configuration object.
 * @param {string} config.localUserId - The local user's ID.
 * @param {function} config.onOpen - Callback when WebSocket opens.
 * @param {function} config.onMessage - Callback for received messages (Offer, Answer, Candidate, Error, User Disconnected).
 * @param {function} config.onError - Callback for WebSocket errors.
 * @param {function} config.onClose - Callback when WebSocket closes.
 */
export function connectWebSocket(config) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket is already open or connecting.");
        return;
    }
    console.log(`Attempting to connect to signaling server: ${signalingServerUrl}`);
    // Indicate connection attempt (caller should update UI)
    ws = new WebSocket(signalingServerUrl);

    ws.onopen = () => {
        console.log("WebSocket connection established.");
        const registerMsg = { type: "register", payload: { userId: config.localUserId } };
        ws.send(JSON.stringify(registerMsg));
        console.log(`Sent register message for user: ${config.localUserId}`);
        if (config.onOpen) {
            config.onOpen(config.localUserId);
        }
    };

    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
            console.log("Received signaling message:", msg);
        } catch (e) {
            console.error("Failed to parse signaling message:", event.data, e);
            return;
        }

        if (config.onMessage) {
            config.onMessage(msg);
        }
    };

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (config.onError) {
            config.onError(error);
        }
        ws = null; // Ensure ws is reset on error
    };

    ws.onclose = (event) => {
        console.log("WebSocket connection closed:", event.code, event.reason);
        const gracefulClose = event.code === 1000;
        if (config.onClose) {
            config.onClose(gracefulClose); // Pass whether it was a graceful close
        }
        ws = null;
    };
}

/**
 * Sends a message through the WebSocket connection.
 * @param {object} payload - The message payload to send (will be JSON.stringified).
 * @returns {boolean} - True if the message was sent, false otherwise.
 */
export function sendSignalingMessage(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            const messageString = JSON.stringify(payload);
            console.log("Sending signaling message:", payload);
            ws.send(messageString);
            return true;
        } catch (e) {
            console.error("Failed to send signaling message:", e);
            return false;
        }
    } else {
        console.error("Cannot send signaling message: WebSocket is not connected.");
        return false;
    }
}

/**
 * Closes the WebSocket connection if it is open.
 */
export function closeWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("Closing WebSocket connection.");
        ws.close(1000, "Client initiated disconnect"); // Graceful close
    }
    ws = null;
}

/**
 * Checks if the WebSocket is currently connected (OPEN state).
 * @returns {boolean}
 */
export function isWebSocketConnected() {
    return ws !== null && ws.readyState === WebSocket.OPEN;
} 