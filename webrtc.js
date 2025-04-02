import {
    generateKeyPair,
    exportPublicKey,
    importPublicKey,
    deriveSharedKey,
    encryptMessage,
    decryptMessage
} from './crypto.js';
import { sendSignalingMessage } from './signaling.js';

// --- WebRTC State & Config ---
let peerConnection = null;
let dataChannel = null;
let localKeyPair = null;
let peerPublicKey = null;
let sharedKey = null;

// Configuration for the RTCPeerConnection
const peerConnectionConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
        // Add TURN servers here if needed for NAT traversal
    ]
};

// --- Callbacks & Dependencies (Set via initializeWebRTC) ---
let callbacks = {
    addSystemMessage: (text, isError) => console.log(`System Message (${isError ? 'ERROR' : 'INFO'}): ${text}`),
    updateConnectionStatus: (text, type) => console.log(`Connection Status (${type}): ${text}`),
    handleDataChannelMessage: (data) => console.log("Received data channel message:", data),
    handleDataChannelOpen: () => console.log("Data channel opened"),
    handleDataChannelClose: () => console.log("Data channel closed"),
    handleDataChannelError: (error) => console.error("Data channel error:", error),
    onIceCandidate: (candidate) => {
        console.warn("onIceCandidate callback not configured!");
        // Default implementation might try to send via signaling
        // const candidateMsg = { type: 'candidate', payload: { targetUserId: /* needs remoteUserId */ 'unknown', candidate: candidate } };
        // sendSignalingMessage(candidateMsg);
    },
    onIceConnectionStateChange: (state) => console.log(`ICE State Change: ${state}`),
    onNegotiationNeeded: () => console.log("Negotiation Needed (Callback not configured)"),
    resetAppConnectionState: () => console.warn("resetAppConnectionState callback not configured!") // To trigger full reset in main.js
};

/**
 * Initializes the WebRTC module with necessary callbacks from the main script.
 * @param {object} config - Contains callback functions.
 */
export function initializeWebRTC(config) {
    // Merge provided callbacks with defaults
    callbacks = { ...callbacks, ...config };
    console.log("WebRTC module initialized with callbacks.");
}

/**
 * Creates or resets the RTCPeerConnection instance and sets up event listeners.
 * @param {string} remoteUserId - The ID of the remote user (used for signaling candidate target).
 * @returns {RTCPeerConnection | null} The created peer connection or null on error.
 */
export function createPeerConnection(remoteUserId) {
    closePeerConnection(); // Close existing connection first

    console.log("Creating new PeerConnection");
    try {
        peerConnection = new RTCPeerConnection(peerConnectionConfig);

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Generated ICE candidate for ${remoteUserId}:`, event.candidate);
                 // Pass remoteUserId along with the candidate to the callback
                callbacks.onIceCandidate(event.candidate, remoteUserId);
            } else {
                console.log("ICE gathering finished.");
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            if (!peerConnection) return;
            callbacks.onIceConnectionStateChange(peerConnection.iceConnectionState);
        };

        // This handles the case where the *remote* peer initiates the data channel
        peerConnection.ondatachannel = (event) => {
            console.log('ondatachannel event received');
            dataChannel = event.channel; // Assign the received data channel
            console.log("Assigning received data channel:", dataChannel);
            setupDataChannelEvents(dataChannel); // Setup handlers for the *remote-initiated* channel
            // Don't call handleDataChannelOpen here, wait for the channel's onopen event
        };

        peerConnection.onnegotiationneeded = async () => {
             console.log("Negotiation needed event triggered.");
             callbacks.onNegotiationNeeded();
        };

        return peerConnection;

    } catch (e) {
        console.error("Failed to create PeerConnection:", e);
        callbacks.addSystemMessage("创建 PeerConnection 失败。", true);
        callbacks.resetAppConnectionState(); // Trigger full reset
        return null;
    }
}

/**
 * Sets up event listeners for a newly created/received data channel.
 * @param {RTCDataChannel} channel - The data channel instance.
 */
export function setupDataChannelEvents(channel) {
    if (!channel) {
        console.error("setupDataChannelEvents called with null channel");
        return;
    }
    console.log(`Setting up data channel: ${channel.label}, Current State: ${channel.readyState}`);

    // Ensure correct binary type for file transfers
    channel.binaryType = 'arraybuffer';

    channel.onopen = async () => {
        console.log(`Data channel opened: ${channel.label}`);
        callbacks.handleDataChannelOpen(); // Notify main module

        // Start E2EE key exchange process
        try {
            localKeyPair = await generateKeyPair();
        } catch (error) { // Catch errors from generateKeyPair
            callbacks.addSystemMessage("生成本地密钥对失败。", true);
            callbacks.resetAppConnectionState(); // Trigger full reset
            return;
        }

        if (localKeyPair && localKeyPair.publicKey) {
            const exportedKey = await exportPublicKey(localKeyPair.publicKey);
            if (exportedKey) {
                const publicKeyMessage = { type: 'publicKey', payload: exportedKey };
                try {
                    // Send public key immediately
                    channel.send(JSON.stringify(publicKeyMessage));
                    console.log("Sent public key over data channel.");
                    callbacks.addSystemMessage("已发送公钥，等待对方公钥...");

                    // If we already received the peer's key, derive the shared key now
                    if (peerPublicKey) {
                        sharedKey = await deriveSharedKey(localKeyPair.privateKey, peerPublicKey);
                        if (sharedKey) {
                            console.log("E2EE established on channel open!");
                            callbacks.addSystemMessage("端到端加密已建立！可以开始聊天。");
                            // Update status via handleDataChannelOpen callback in main.js
                        } else {
                            callbacks.addSystemMessage("共享密钥派生失败！", true);
                            callbacks.resetAppConnectionState();
                        }
                    }
                } catch (e) {
                    console.error("Failed to send public key:", e);
                    callbacks.addSystemMessage("发送公钥失败。", true);
                    callbacks.resetAppConnectionState();
                }
            } else {
                callbacks.addSystemMessage("导出公钥失败。", true);
                callbacks.resetAppConnectionState();
            }
        } else {
            callbacks.addSystemMessage("生成本地密钥对失败 (post-check)。", true);
            callbacks.resetAppConnectionState();
        }
    };

    channel.onmessage = async (event) => {
        // Separate binary data first
        if (event.data instanceof ArrayBuffer) {
            callbacks.handleDataChannelMessage({ type: 'binary', payload: event.data });
            return;
        }

        // Handle JSON messages
        console.log(`Raw JSON data channel message received:`, event.data);
        let msgData;
        try {
            msgData = JSON.parse(event.data);
        } catch (e) {
            console.error("Failed to parse JSON message:", event.data, e);
            return;
        }

        switch (msgData.type) {
            case 'publicKey':
                console.log("Received peer public key.");
                callbacks.addSystemMessage("收到对方公钥，正在设置加密...");
                peerPublicKey = await importPublicKey(msgData.payload);
                if (peerPublicKey) {
                    // If we have our keys already, derive shared key
                    if (localKeyPair && localKeyPair.privateKey) {
                        sharedKey = await deriveSharedKey(localKeyPair.privateKey, peerPublicKey);
                        if (sharedKey) {
                            console.log("E2EE established after receiving peer key!");
                            callbacks.addSystemMessage("端到端加密已建立！可以开始聊天。");
                            // Potentially update connection status here or via a dedicated callback
                        } else {
                            callbacks.addSystemMessage("共享密钥派生失败！", true);
                            callbacks.resetAppConnectionState();
                        }
                    } else {
                        console.log("Received peer key, but local keys not ready yet. Waiting for data channel open.");
                    }
                } else {
                    callbacks.addSystemMessage("导入对方公钥失败。", true);
                    callbacks.resetAppConnectionState();
                }
                break;
            default:
                // Pass other JSON messages to the main handler
                 callbacks.handleDataChannelMessage(msgData);
        }
    };

    channel.onclose = () => {
        console.log(`Data channel closed: ${channel.label}`);
        callbacks.handleDataChannelClose();
    };

    channel.onerror = (error) => {
        console.error(`Data channel error: ${channel.label}`, error);
        callbacks.handleDataChannelError(error);
    };
}

/**
 * Initiates a call by creating a PeerConnection, DataChannel, and sending an Offer.
 * @param {string} targetUserId - The ID of the user to call.
 */
export async function initiateCall(targetUserId) {
    console.log(`Initiating call to ${targetUserId}`);
    const pc = createPeerConnection(targetUserId);
    if (!pc) {
        callbacks.addSystemMessage("无法创建 PeerConnection 来发起呼叫。", true);
        return;
    }

    try {
        console.log("Creating data channel on initiator side");
        // Create the data channel *before* creating the offer
        const dc = pc.createDataChannel("chatChannel", { reliable: true });
        dataChannel = dc; // Assign to module variable
        setupDataChannelEvents(dc); // Setup handlers immediately
    } catch (e) {
        console.error("Failed to create data channel:", e);
        callbacks.addSystemMessage("创建数据通道失败。", true);
        callbacks.resetAppConnectionState();
        return;
    }

    try {
        const offer = await pc.createOffer();
        console.log("Offer created");
        await pc.setLocalDescription(offer);
        console.log("Local description (offer) set");

        const offerMsg = { type: 'offer', payload: { targetUserId: targetUserId, sdp: pc.localDescription } };
        if (sendSignalingMessage(offerMsg)) {
            console.log("Offer sent to signaling server");
            callbacks.updateConnectionStatus(`Offer 已发送至 ${targetUserId}`, 'progress');
        } else {
            callbacks.addSystemMessage("发送 Offer 失败：WebSocket 未连接。", true);
            callbacks.resetAppConnectionState();
        }
    } catch (error) {
        console.error("Error creating/sending offer:", error);
        callbacks.addSystemMessage(`创建或发送 Offer 失败: ${error}`, true);
        callbacks.resetAppConnectionState();
    }
}

/**
 * Handles a received Offer, creates an Answer, and sends it.
 * @param {RTCSessionDescriptionInit} offerSdp - The SDP of the received offer.
 * @param {string} offererUserId - The ID of the user who sent the offer.
 */
export async function handleOfferAndCreateAnswer(offerSdp, offererUserId) {
    console.log(`Handling offer from ${offererUserId}`);
    let pc = getPeerConnection();
    if (pc) {
         console.warn("Existing PeerConnection found when handling offer. Closing and creating new one.");
         closePeerConnection();
         resetWebRTCState(); // Reset keys too
    }

    pc = createPeerConnection(offererUserId);
    if (!pc) {
        callbacks.addSystemMessage("处理 Offer 时创建 PeerConnection 失败。", true);
        return;
    }
    // Note: ondatachannel listener is set within createPeerConnection

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
        console.log("Remote description (offer) set");
        callbacks.updateConnectionStatus(`收到 Offer，正在创建 Answer...`, 'progress');

        const answer = await pc.createAnswer();
        console.log("Answer created");
        await pc.setLocalDescription(answer);
        console.log("Local description (answer) set");

        const answerMsg = { type: 'answer', payload: { targetUserId: offererUserId, sdp: pc.localDescription } };
        if (sendSignalingMessage(answerMsg)) {
            console.log("Answer sent to signaling server");
            callbacks.updateConnectionStatus(`Answer 已发送至 ${offererUserId}`, 'progress');
        } else {
            callbacks.addSystemMessage("发送 Answer 失败：WebSocket 未连接。", true);
            callbacks.resetAppConnectionState();
        }
    } catch (error) {
        console.error("Error handling offer/creating answer:", error);
        callbacks.addSystemMessage(`处理 Offer 或创建 Answer 失败: ${error}`, true);
        callbacks.resetAppConnectionState();
    }
}

/**
 * Handles a received Answer.
 * @param {RTCSessionDescriptionInit} answerSdp - The SDP of the received answer.
 */
export async function handleAnswer(answerSdp) {
    const pc = getPeerConnection();
    if (!pc) { console.error("Received answer but PeerConnection is missing."); return; }
    if (!pc.localDescription) { console.error("Received answer but local description is missing."); return; }
    // Should not set remote description if connection is already stable? Check pc.signalingState
    if (pc.signalingState !== 'have-local-offer') {
         console.warn(`Received answer in unexpected signaling state: ${pc.signalingState}. Ignoring.`);
         return;
    }

    console.log("Handling received answer.");
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
        console.log("Remote description (answer) set");
        callbacks.updateConnectionStatus(`应答已处理，等待连接...`, 'progress');
    } catch (error) {
        console.error("Error setting remote description (answer):", error);
        callbacks.addSystemMessage(`设置远程 Answer 失败: ${error}`, true);
        callbacks.resetAppConnectionState();
    }
}

/**
 * Handles a received ICE Candidate.
 * @param {RTCIceCandidateInit} candidate - The received ICE candidate.
 */
export async function handleCandidate(candidate) {
    const pc = getPeerConnection();
    if (!pc) { console.warn("Received candidate but PeerConnection is not ready yet."); return; }

    // Wait until remote description is set before adding candidate
    if (!pc.remoteDescription) {
        console.warn("Received candidate but remote description is not set yet. Candidate might be lost.");
        // TODO: Implement candidate queueing if necessary
        return;
    }
    // Avoid adding candidates if connection is closed or failed
    if (pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'failed') {
         console.warn(`Received candidate but connection is ${pc.iceConnectionState}. Ignoring.`);
         return;
    }

    try {
        const rtcCandidate = new RTCIceCandidate(candidate);
        await pc.addIceCandidate(rtcCandidate);
        console.log("ICE candidate added successfully");
    } catch (error) {
        // Ignore benign errors like candidate already added or peer connection closed
        if (error.name !== 'OperationError' && !error.message.includes('connection is closed')) {
             console.warn("Error adding ICE candidate:", error);
        }
    }
}

/**
 * Closes the data channel and the peer connection if they exist.
 */
export function closePeerConnection() {
    if (dataChannel) {
        console.log("Closing DataChannel");
        dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        console.log("Closing PeerConnection");
        peerConnection.close();
        peerConnection = null;
    }
}

/**
 * Resets the WebRTC state variables (keys, etc.).
 */
export function resetWebRTCState() {
    console.log("Resetting WebRTC state variables.");
    localKeyPair = null;
    peerPublicKey = null;
    sharedKey = null;
    // Note: peerConnection and dataChannel are handled by closePeerConnection
}

// --- Getters/Setters ---
export function getPeerConnection() { return peerConnection; }
export function getDataChannel() { return dataChannel; }
export function getLocalKeyPair() { return localKeyPair; }
export function getPeerPublicKey() { return peerPublicKey; }
export function getSharedKey() { return sharedKey; }
// No setters exposed externally for keys, managed internally via data channel exchange 