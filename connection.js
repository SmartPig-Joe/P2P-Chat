// connection.js
import * as state from './state.js';
import { SIGNALING_SERVER_URL, PEER_CONNECTION_CONFIG } from './constants.js';
import * as ui from './ui.js';
import * as crypto from './crypto.js';
import * as fileTransfer from './fileTransfer.js';
import * as dom from './dom.js'; // Needed for updating UI elements based on WS state
import * as storage from './storage.js'; // Import storage module

// --- WebSocket Logic ---

function sendSignalingMessage(payload) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        try {
            const messageString = JSON.stringify(payload);
            state.ws.send(messageString);
        } catch (e) {
            console.error("Failed to stringify or send signaling message:", e);
            ui.addSystemMessage("无法发送信令：数据错误。", true);
        }
    } else {
        console.error("Cannot send signaling message: WebSocket is not connected.");
        ui.addSystemMessage("无法发送信令：WebSocket 未连接。", true);
    }
}

function handleWebSocketMessage(event) {
    let msg;
    try {
        msg = JSON.parse(event.data);
    } catch (e) {
        console.error("Failed to parse signaling message:", event.data, e);
        return;
    }

    if (!msg.type) {
         console.warn("Received signaling message without type:", msg);
         return;
    }

    switch (msg.type) {
        case 'offer':
            if (state.isConnected || state.isConnecting) {
                console.warn(`Ignoring offer from ${msg.from}, already connected/connecting to ${state.remoteUserId}`);
                sendSignalingMessage({ type: 'busy', payload: { targetUserId: msg.from } });
                return;
            }
            if (!msg.from || !msg.payload?.sdp) {
                console.warn("Invalid offer received:", msg);
                return;
            }
            const offererId = msg.from;
            state.setRemoteUserId(offererId); // Tentatively set remote user
            state.setIsConnecting(true);
            console.log(`Received offer from ${offererId}`);
            ui.addSystemMessage(`收到来自 ${state.contacts[offererId]?.name || offererId} 的连接请求...`);
            // Update the contact's UI to indicate connection attempt (visual only, status remains offline)
            // We don't set status to online yet, just indicate activity.
            // The handleOffer function below will create the peer connection.
            handleOffer(msg.payload.sdp);
            break;

        case 'answer':
            if (!msg.from || msg.from !== state.remoteUserId) {
                console.warn(`Received answer from unexpected peer ${msg.from}. Current remote: ${state.remoteUserId}. Ignoring.`);
                return;
            }
             if (!msg.payload?.sdp) {
                console.warn("Invalid answer received:", msg);
                return;
            }
            console.log(`Received answer from ${state.remoteUserId}`);
            handleAnswer(msg.payload.sdp);
            break;

        case 'candidate':
            if (!msg.from || (state.remoteUserId && msg.from !== state.remoteUserId)) {
                 console.warn(`Received candidate from unexpected peer ${msg.from}. Current remote: ${state.remoteUserId}. Ignoring.`);
                 return;
            }
            if (!msg.payload?.candidate) {
                console.warn("Invalid candidate received:", msg);
                return;
            }
            console.log(`Received ICE candidate from ${msg.from}`);
            handleCandidate(msg.payload.candidate);
            break;

        case 'error':
            const errorMsg = msg.payload?.message || '未知错误';
            console.error(`Received error from signaling server: ${errorMsg}`);
            ui.addSystemMessage(`信令服务器错误: ${errorMsg}`, true);
            if (errorMsg.includes("not found") || errorMsg.includes("offline")) {
                 const targetPeer = state.remoteUserId; // Store before resetting
                 ui.addSystemMessage(`目标用户 ${state.contacts[targetPeer]?.name || targetPeer || ''} 未找到或离线。`, true);
                 resetConnection();
                 if (targetPeer) {
                     state.updateContactStatus(targetPeer, false); // Ensure state is offline
                     ui.updateContactStatusUI(targetPeer, false); // Update UI
                 }
            }
            break;

        case 'busy':
             if (msg.from === state.remoteUserId) {
                 const busyPeer = state.remoteUserId;
                 console.log(`${busyPeer} is busy.`);
                 ui.addSystemMessage(`${state.contacts[busyPeer]?.name || busyPeer} 当前正忙，请稍后再试。`, true);
                 resetConnection(); // Reset the connection attempt state
                 state.updateContactStatus(busyPeer, false);
                 ui.updateContactStatusUI(busyPeer, false);
             }
             break;

        case 'user_disconnected': // Server indicates a user left the signaling server
             const disconnectedUserId = msg.payload?.userId;
             if (disconnectedUserId) {
                 console.log(`Signaling server indicated ${disconnectedUserId} disconnected.`);
                 if (disconnectedUserId === state.remoteUserId) {
                     ui.addSystemMessage(`${state.contacts[disconnectedUserId]?.name || disconnectedUserId} 已断开连接。`);
                     resetConnection(); // Reset the P2P connection state
                 } else if (state.contacts[disconnectedUserId]) {
                    // User was in contacts but not actively connected, update their status
                    state.updateContactStatus(disconnectedUserId, false);
                    ui.updateContactStatusUI(disconnectedUserId, false);
                 }
             }
            break;

        default:
            console.log("Received unhandled signaling message type:", msg.type);
    }
}

export function connectWebSocket() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket is already open or connecting.");
        return;
    }
    console.log(`Attempting to connect to signaling server: ${SIGNALING_SERVER_URL}`);

    const newWs = new WebSocket(SIGNALING_SERVER_URL);

    newWs.onopen = () => {
        console.log("WebSocket connection established.");
        state.setWs(newWs);

        const registerMsg = { type: "register", payload: { userId: state.localUserId } };
        sendSignalingMessage(registerMsg);
        console.log(`Sent register message for user: ${state.localUserId}`);

        ui.addSystemMessage(`已连接到信令服务器，您的 ID 是: ${state.localUserId}`);
    };

    newWs.onmessage = handleWebSocketMessage;

    newWs.onerror = (error) => {
        console.error("WebSocket error:", error);
        ui.addSystemMessage("无法连接到信令服务器，请检查服务器状态和网络连接。", true);
        state.setWs(null);
        resetConnection(); // Also reset P2P state if WS fails
        // Update all contacts to offline
        Object.keys(state.contacts).forEach(peerId => {
             state.updateContactStatus(peerId, false);
             ui.updateContactStatusUI(peerId, false);
        });
         ui.updateChatInputVisibility(); // Replace updateGeneralConnectionUI
    };

    newWs.onclose = (event) => {
        console.log(`WebSocket connection closed: Code=${event.code}, Reason='${event.reason}'`);
        if (!event.wasClean && !state.isConnected) {
             ui.addSystemMessage("与信令服务器的连接意外断开。", true);
        } else if (!state.isConnected) {
        }

        state.setWs(null);
        resetConnection(); // Reset P2P state when WS closes
         // Update all contacts to offline
         Object.keys(state.contacts).forEach(peerId => {
             state.updateContactStatus(peerId, false);
             ui.updateContactStatusUI(peerId, false);
        });
        ui.updateChatInputVisibility(); // Replace updateGeneralConnectionUI
    };
}

// --- WebRTC Logic ---

function createPeerConnection() {
    if (state.peerConnection) {
        console.log("Closing existing PeerConnection before creating new one.");
        try {
            state.peerConnection.close();
        } catch (e) { console.warn("Error closing existing PeerConnection:", e); }
        state.setPeerConnection(null);
    }

    console.log("Creating new PeerConnection with config:", PEER_CONNECTION_CONFIG);
    try {
        const newPc = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
        state.setPeerConnection(newPc);
        setupPeerConnectionEvents(newPc);
        return newPc; // Return the created connection
    } catch (e) {
        console.error("Failed to create PeerConnection:", e);
        const targetPeer = state.remoteUserId; // Store before resetting
        ui.addSystemMessage("创建 PeerConnection 失败。", true);
        resetConnection();
         if (targetPeer) {
             state.updateContactStatus(targetPeer, false);
             ui.updateContactStatusUI(targetPeer, false);
         }
        throw new Error("PeerConnection creation failed");
    }
}

function setupPeerConnectionEvents(pc) {
    pc.onicecandidate = (event) => {
        if (event.candidate && state.remoteUserId) {
            console.log(`Generated ICE candidate for ${state.remoteUserId}`);
            const candidateMsg = {
                type: 'candidate',
                payload: {
                    targetUserId: state.remoteUserId,
                    candidate: event.candidate
                }
            };
            sendSignalingMessage(candidateMsg);
        } else if (!event.candidate) {
            console.log("ICE gathering finished.");
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (!pc) return;
        console.log(`ICE connection state changed to: ${pc.iceConnectionState}`);
        switch (pc.iceConnectionState) {
            case 'checking':
                state.setIsConnecting(true);
                 // ui.updateContactStatusUI(state.remoteUserId, false); // Keep offline during check?
                // ui.updateGeneralConnectionUI();
                break;
            case 'connected': // Indicates connection is established, but not necessarily verified end-to-end
                state.setIsConnecting(false);
                 // Data channel open is the more reliable indicator
                 // ui.updateContactStatusUI(state.remoteUserId, true);
                 // ui.updateGeneralConnectionUI();
                break;
            case 'completed': // All ICE transports established
                console.log("ICE connection completed.");
                break;
            case 'failed':
                console.error("ICE connection failed.");
                 const failedPeer = state.remoteUserId; // Store before reset
                 ui.addSystemMessage(`与 ${state.contacts[failedPeer]?.name || failedPeer || '远程用户'} 的连接失败。`, true);
                 resetConnection();
                 if (failedPeer) {
                     state.updateContactStatus(failedPeer, false);
                     ui.updateContactStatusUI(failedPeer, false);
                 }
                break;
            case 'disconnected':
                console.warn("ICE connection disconnected. May reconnect...");
                 const disconnectedPeer = state.remoteUserId; // Store before reset
                 // Don't immediately reset, give it a chance to reconnect
                 state.setIsConnected(false);
                 state.setIsConnecting(false);
                 if (disconnectedPeer) {
                     state.updateContactStatus(disconnectedPeer, false); // Show as offline during disconnect
                     ui.updateContactStatusUI(disconnectedPeer, false);
                 }
                 ui.updateChatInputVisibility(); // Replace updateGeneralConnectionUI
                 // Consider starting a timer to fully reset if it doesn't reconnect
                break;
            case 'closed':
                console.log("ICE connection closed.");
                 const closedPeer = state.remoteUserId; // Store before reset
                 // Ensure state is fully reset if closed unexpectedly
                 if (state.isConnected || state.isConnecting) {
                     resetConnection();
                     if (closedPeer) {
                         state.updateContactStatus(closedPeer, false);
                         ui.updateContactStatusUI(closedPeer, false);
                     }
                 }
                break;
        }
    };

    pc.ondatachannel = (event) => {
        console.log("Data channel received");
        const receiveChannel = event.channel;
        setupDataChannelEvents(receiveChannel);
        state.setDataChannel(receiveChannel);
    };

    pc.onnegotiationneeded = async () => {
        // This might be triggered if STUN/TURN requires renegotiation, or adding tracks later
        console.log("Negotiation needed event triggered.");
         if (state.isConnecting || !state.remoteUserId || !state.peerConnection || state.peerConnection.signalingState !== 'stable') {
             console.log("Skipping renegotiation due to unstable state.");
             return;
         }
        try {
             console.log("Attempting renegotiation (creating offer)...");
             const offer = await pc.createOffer();
             await pc.setLocalDescription(offer);
             sendSignalingMessage({ type: 'offer', payload: { targetUserId: state.remoteUserId, sdp: pc.localDescription } });
             console.log("Sent renegotiation offer.");
         } catch (error) {
             console.error("Error during renegotiation:", error);
             ui.addSystemMessage("连接重新协商失败。", true);
             resetConnection();
         }
    };

     pc.onsignalingstatechange = () => {
         if (!pc) return;
         console.log(`Signaling state changed to: ${pc.signalingState}`);
         // Potential place to handle errors or state transitions
     };
}

async function setupDataChannelEvents(dc) {
    dc.onopen = async () => {
        const connectedPeerId = state.remoteUserId; // Capture the ID at the time of opening
        if (!connectedPeerId) {
            console.error("Data channel opened but remoteUserId is null!");
            resetConnection();
            return;
        }
        console.log(`Data channel opened with ${connectedPeerId}`);
        state.setIsConnected(true);
        state.setIsConnecting(false);

        // Update state and UI for the connected peer
        state.updateContactStatus(connectedPeerId, true);
        ui.updateContactStatusUI(connectedPeerId, true);

        ui.addSystemMessage(`已连接到 ${state.contacts[connectedPeerId]?.name || connectedPeerId}。`);

        if (state.localKeyPair && state.localKeyPair.publicKey) {
            try {
                const publicKeyJwk = await crypto.exportPublicKey(state.localKeyPair.publicKey);
                if (publicKeyJwk) {
                    const keyMessage = {
                        type: 'public-key',
                        payload: publicKeyJwk
                    };
                    if (state.dataChannel && state.dataChannel.readyState === 'open') {
                        state.dataChannel.send(JSON.stringify(keyMessage));
                        console.log("Sent public key to peer.");
                    } else {
                         console.warn("Data channel closed or became invalid before public key could be sent.");
                         resetConnection();
                         return;
                    }
                } else {
                    console.error("Failed to export local public key. Cannot perform key exchange.");
                    ui.addSystemMessage("导出本地公钥失败，无法建立加密连接。", true);
                    resetConnection();
                    return;
                }
            } catch (error) {
                console.error("Error during public key export/send:", error);
                ui.addSystemMessage("发送公钥时出错，无法建立加密连接。", true);
                resetConnection();
                return;
            }
        } else {
             console.error("Cannot send public key: Local key pair not generated or available.");
             ui.addSystemMessage("本地密钥对不可用，无法建立加密连接。", true);
             resetConnection();
             return;
        }

         // Update general UI (e.g., enable chat input)
         ui.updateChatInputVisibility(); // Replace updateGeneralConnectionUI
    };

    dc.onclose = () => {
        const closedPeerId = state.remoteUserId; // Capture ID before potential reset
        console.log(`Data channel closed with ${closedPeerId}`);
         // Only reset if the peer connection isn't already closing/closed
         // and if we were actually connected to this peer
         if (state.isConnected && closedPeerId && state.peerConnection && state.peerConnection.connectionState !== 'closed') {
             resetConnection(); // Reset the state if the channel closes unexpectedly
             if (closedPeerId) { // Check again after potential reset
                 ui.addSystemMessage(`与 ${state.contacts[closedPeerId]?.name || closedPeerId} 的连接已断开。`);
                 // Status is updated within resetConnection now
             }
         } else if (state.isConnecting && closedPeerId) {
             // If it closes while connecting, it's a failure
             console.log(`Data channel closed while connecting to ${closedPeerId}.`);
             resetConnection();
             if (closedPeerId) {
                 ui.addSystemMessage(`无法连接到 ${state.contacts[closedPeerId]?.name || closedPeerId} (数据通道关闭)。`, true);
             }
         }

        ui.updateChatInputVisibility(); // Replace updateGeneralConnectionUI
    };

    dc.onerror = (error) => {
        const errorPeerId = state.remoteUserId; // Capture ID
        console.error(`Data channel error with peer ${errorPeerId}:`, error);

        // Check if the error is likely due to an intentional close (resetConnection being called elsewhere)
        // or if the connection state indicates it's already being torn down.
        const isClosing = !state.peerConnection ||
                          ['closed', 'failed', 'disconnected'].includes(state.peerConnection.connectionState);

        const isUserAbortError = error.error instanceof DOMException && // Check if error.error exists and is a DOMException
                               error.error.name === 'OperationError' &&
                               error.error.message.includes('Close called');

        if (isClosing || isUserAbortError) {
            console.warn(`Data channel error ignored as connection is already closing/closed or it's a direct consequence of closing the channel.`);
            // If the connection is already closing or the error is just reporting the close, no need to reset again.
        } else {
            // Unexpected data channel error, treat it as a connection failure.
            ui.addSystemMessage(`与 ${state.contacts[errorPeerId]?.name || errorPeerId || '远程用户'} 的数据通道发生意外错误。`, true);
            resetConnection();
            // Status update handled by resetConnection
        }
    };

    dc.onmessage = (event) => {
        const currentRemoteId = state.remoteUserId; // Ensure message is from current peer
        if (typeof event.data === 'string') {
            try {
                const message = JSON.parse(event.data);
                if (message.senderId && message.senderId !== currentRemoteId) {
                     console.warn(`Ignoring message from unexpected sender ${message.senderId}. Expected ${currentRemoteId}.`);
                     return;
                }

                switch (message.type) {
                    case 'chat':
                        crypto.decryptMessage(message.payload).then(decryptedText => {
                             const msgData = {
                                 peerId: currentRemoteId, // Sender is the connected remote peer
                                 text: decryptedText,
                                 timestamp: message.timestamp || Date.now(),
                                 isLocal: false,
                                 isEncrypted: true
                             };
                             ui.addP2PMessageToList(msgData);
                             storage.addMessageToHistory(currentRemoteId, msgData);
                        }).catch(err => {
                             console.error("Decryption failed:", err);
                             ui.addSystemMessage("收到无法解密的消息。", true);
                             const msgData = {
                                 peerId: currentRemoteId,
                                 text: "[无法解密的消息]",
                                 timestamp: message.timestamp || Date.now(),
                                 isLocal: false,
                                 isEncrypted: false
                             };
                             ui.addP2PMessageToList(msgData);
                             storage.addMessageToHistory(currentRemoteId, msgData);
                        });
                        break;
                    case 'typing':
                        if (message.payload === 'start') {
                            ui.showTypingIndicator();
                        } else if (message.payload === 'stop') {
                            ui.hideTypingIndicator();
                        }
                        break;
                    case 'public-key':
                        console.log("Received public key");
                        crypto.handlePublicKey(message.payload);
                        break;
                    case 'file-info':
                        console.log("Received file-info");
                         const fileInfoPayload = { ...message.payload, senderId: currentRemoteId };
                         fileTransfer.handleIncomingFileInfo(fileInfoPayload);
                        break;
                     case 'file-end':
                         console.log("Received file-end");
                         fileTransfer.handleIncomingFileEnd(message.payload);
                         break;
                    default:
                        console.log("Received unhandled message type:", message.type);
                }
            } catch (e) {
                console.error("Failed to parse incoming string message or handle it:", event.data, e);
                ui.addSystemMessage("收到无法处理的文本消息。", true);
            }
        } else if (event.data instanceof ArrayBuffer) {
            // console.log("Received binary message (ArrayBuffer), size:", event.data.byteLength);
            fileTransfer.handleIncomingFileChunk(event.data);
        } else {
            console.warn("Received message of unknown type:", typeof event.data, event.data);
        }
    };
}

async function handleOffer(offerSdp) {
    if (!state.remoteUserId) {
        console.error("Cannot handle offer: remoteUserId not set.");
        return;
    }
    try {
        const pc = createPeerConnection(); // Create PC first
        if (!pc) throw new Error("PeerConnection creation failed in handleOffer");

        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
        console.log("Remote description (offer) set.");

        console.log("Creating answer...");
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log("Local description (answer) set.");

        const answerMsg = {
            type: 'answer',
            payload: {
                targetUserId: state.remoteUserId,
                sdp: pc.localDescription
            }
        };
        sendSignalingMessage(answerMsg);
        console.log("Sent answer.");
    } catch (error) {
        console.error("Error handling offer:", error);
        const failedPeer = state.remoteUserId; // Store before reset
        ui.addSystemMessage(`处理来自 ${state.contacts[failedPeer]?.name || failedPeer || '未知用户'} 的连接请求失败。`, true);
        resetConnection(); // Resets state & UI generally
        // Explicitly update status for the specific peer after reset
        if (failedPeer) {
            state.updateContactStatus(failedPeer, false);
            ui.updateContactStatusUI(failedPeer, false);
        }
    }
}

async function handleAnswer(answerSdp) {
    if (!state.peerConnection) {
        console.error("Cannot handle answer: PeerConnection not initialized.");
        return;
    }
    try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
        console.log("Remote description (answer) set.");
        // Connection should now establish via ICE state changes and data channel events
    } catch (error) {
        console.error("Error handling answer:", error);
        const targetPeer = state.remoteUserId; // Store before reset
        ui.addSystemMessage(`处理来自 ${state.contacts[targetPeer]?.name || targetPeer} 的应答失败。`, true);
        resetConnection();
         if (targetPeer) {
             state.updateContactStatus(targetPeer, false);
             ui.updateContactStatusUI(targetPeer, false);
         }
    }
}

async function handleCandidate(candidate) {
    if (!state.peerConnection) {
        console.warn("Cannot handle candidate: PeerConnection not initialized. Buffering might be needed.");
        // TODO: Implement candidate buffering if needed
        return;
    }
    try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        // console.log("Added ICE candidate."); // Less verbose
    } catch (error) {
        // Ignore benign errors like candidate already added or state preventing it
         if (error.name !== 'InvalidStateError' && !error.message.includes("applied")) {
             console.error("Error adding ICE candidate:", error);
             // Don't reset the whole connection for a single bad candidate usually
             // ui.addSystemMessage(`处理 ICE candidate 时出错。`, true);
         }
    }
}

// --- Public Connection Functions ---

/**
 * Initiates a connection to a target peer.
 * @param {string} targetPeerId The ID of the peer to connect to.
 */
export async function connectToPeer(targetPeerId) {
    if (!targetPeerId || targetPeerId === state.localUserId) {
        console.warn("Invalid target peer ID or connecting to self.");
        ui.addSystemMessage("无效的目标用户 ID。", true);
        return;
    }
    if ((state.isConnected || state.isConnecting) && state.remoteUserId === targetPeerId) {
        console.log(`Already connected or connecting to ${targetPeerId}. No action needed.`);
        return;
    }

    if ((state.isConnected || state.isConnecting) && state.remoteUserId !== targetPeerId) {
        console.warn(`Already connected/connecting to ${state.remoteUserId}. Disconnecting first to connect to ${targetPeerId}.`);
        ui.addSystemMessage(`正在断开与 ${state.contacts[state.remoteUserId]?.name || state.remoteUserId} 的连接...`);
        disconnectFromPeer();
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        console.error("Cannot initiate connection: WebSocket not connected.");
        ui.addSystemMessage("无法发起连接：未连接到信令服务器。", true);
        return;
    }

    console.log(`Initiating connection to ${targetPeerId}...`);
    state.setRemoteUserId(targetPeerId);
    state.setIsConnecting(true);
    state.setIsConnected(false);

    ui.addSystemMessage(`正在尝试连接 ${state.contacts[targetPeerId]?.name || targetPeerId}...`);
    ui.updateChatInputVisibility();

    try {
        // Generate new key pair for this connection attempt
        console.log("Generating new key pair for this connection...");
        await crypto.generateAndStoreKeyPair();
        console.log("New key pair generated and stored.");

        const pc = createPeerConnection();
        if (!pc) throw new Error("PeerConnection creation failed");

        console.log("Creating data channel...");
        const dc = pc.createDataChannel("chatChannel");
        setupDataChannelEvents(dc);
        state.setDataChannel(dc);
        console.log("Data channel created.");

        console.log("Creating offer...");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log("Local description (offer) set.");

        const offerMsg = {
            type: 'offer',
            payload: {
                targetUserId: targetPeerId,
                sdp: pc.localDescription
            }
        };
        sendSignalingMessage(offerMsg);
        console.log("Sent offer.");

    } catch (error) {
        console.error(`Error initiating connection to ${targetPeerId}:`, error);
        const failedPeer = targetPeerId;
        // Handle potential error during key generation as well
        if (error.message.includes("Key generation failed")) {
            ui.addSystemMessage(`生成加密密钥失败，无法连接到 ${state.contacts[failedPeer]?.name || failedPeer}。`, true);
        } else {
            ui.addSystemMessage(`发起与 ${state.contacts[failedPeer]?.name || failedPeer} 的连接失败。`, true);
        }
        resetConnection();
    }
}

/**
 * Disconnects from the currently connected peer.
 */
export function disconnectFromPeer() {
    const peerToDisconnect = state.remoteUserId; // Capture the ID before resetting
    console.log(`Disconnecting from peer: ${peerToDisconnect || 'N/A'}...`);

    resetConnection(); // Resets state variables and closes PC/DC, updates UI

    if (peerToDisconnect) {
         // Send disconnect message via signaling? Optional.
         // sendSignalingMessage({ type: 'disconnect', payload: { targetUserId: peerToDisconnect } });

         ui.addSystemMessage(`已断开与 ${state.contacts[peerToDisconnect]?.name || peerToDisconnect} 的连接。`);
         // Status UI is updated within resetConnection
    } else if (!state.isConnected && !state.isConnecting) {
         // If called when not connected/connecting, just log it.
         console.log("disconnectFromPeer called but not connected/connecting.");
         // ui.addSystemMessage("当前未连接。", false);
    }
    // General UI update is handled by resetConnection
}

/**
 * Resets the WebRTC connection state and related variables.
 */
function resetConnection() {
    console.log("Resetting connection state...");
    const previousPeer = state.resetConnectionState();

    ui.hideTypingIndicator();

    if (previousPeer && state.contacts[previousPeer]) {
        ui.updateContactStatusUI(previousPeer, false);
        console.log(`[Reset] Ensured UI status for ${previousPeer} is offline.`);
    } else if (previousPeer) {
        console.log(`[Reset] Previous peer ${previousPeer} not found in contacts.`);
    }

    ui.updateChatInputVisibility(); // Replace updateGeneralConnectionUI
    console.log("Connection state reset complete.");
}

// --- Message Sending ---

export function sendChatMessage(text) {
    if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open') {
        ui.addSystemMessage("无法发送消息：未连接或数据通道未就绪。", true);
        return;
    }
    if (!state.sharedKey) {
         ui.addSystemMessage("无法发送消息：端到端加密密钥交换未完成。", true);
         return;
    }

    crypto.encryptMessage(text).then(encryptedPayload => {
        const message = {
            type: 'chat',
            payload: encryptedPayload,
            timestamp: Date.now()
        };
         try {
            state.dataChannel.send(JSON.stringify(message));
             const msgData = {
                 peerId: state.remoteUserId,
                 text: text,
                 timestamp: message.timestamp,
                 isLocal: true,
                 isEncrypted: true
             };
             ui.addP2PMessageToList(msgData);
             storage.addMessageToHistory(state.remoteUserId, msgData);

         } catch (e) {
             console.error("Error sending chat message:", e);
             ui.addSystemMessage("发送消息失败。", true);
         }
    }).catch(err => {
         console.error("Encryption failed:", err);
         ui.addSystemMessage("加密消息失败，无法发送。", true);
    });
}

let typingTimer = null;
export function sendTypingIndicator(isTyping) {
    if (!state.isConnected || !state.dataChannel || state.dataChannel.readyState !== 'open') {
        return;
    }

    if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
    }

    const payload = isTyping ? 'start' : 'stop';
    const message = { type: 'typing', payload: payload };

    try {
        if (isTyping) {
            state.dataChannel.send(JSON.stringify(message));
            typingTimer = setTimeout(() => {
                 const stopMessage = { type: 'typing', payload: 'stop' };
                 try {
                    if (state.dataChannel && state.dataChannel.readyState === 'open') {
                         state.dataChannel.send(JSON.stringify(stopMessage));
                         state.setIsTyping(false);
                    }
                 } catch (e) { console.warn("Error sending stop typing indicator:", e); }
                 typingTimer = null;
            }, 3000);
        } else {
            state.dataChannel.send(JSON.stringify(message));
             state.setIsTyping(false);
        }
    } catch (e) {
        console.warn("Error sending typing indicator:", e);
    }
}

// --- History Loading --- (Moved from ui.js)

/**
 * Loads and displays message history for a given peer.
 * @param {string} peerId The ID of the peer whose history to load.
 */
export async function loadAndDisplayHistory(peerId) {
     if (!peerId) return;
     console.log(`Loading history for ${peerId}...`);

     try {
         const history = await storage.getMessages(peerId);
         if (history && history.length > 0) {
             console.log(`Displaying ${history.length} messages from history for ${peerId}`);
             history.forEach(msgData => {
                 if (msgData.type === 'chat') {
                    ui.addP2PMessageToList(msgData);
                 } else if (msgData.type === 'file') {
                     let progress = msgData.progress === undefined ? (msgData.status === 'complete' ? 1 : (msgData.status === 'failed' ? -1 : 0)) : msgData.progress;
                     let downloadUrl = msgData.downloadUrl || null;
                     ui.addFileMessageToList(msgData.fileInfo, msgData.isLocal, downloadUrl, progress);
                 } else if (msgData.type === 'system') {
                     ui.addSystemMessage(msgData.text, msgData.isError);
                 }
             });
         } else {
             console.log(`No history found for ${peerId}`);
         }
     } catch (error) {
         console.error(`Error loading or displaying history for ${peerId}:`, error);
         ui.addSystemMessage(`加载 ${peerId} 的历史记录时出错。`, true);
     }
     ui.scrollToBottom();
     ui.updateEmptyState();
 }

// Function to handle application losing focus (visibility change)
function handleVisibilityChange() {
    if (document.hidden) {
        if (state.isTyping && typingTimer) {
            clearTimeout(typingTimer);
            typingTimer = null;
             sendTypingIndicator(false);
             console.log("Window hidden, stopped typing indicator timer.");
        }
    }
}

document.addEventListener("visibilitychange", handleVisibilityChange, false);