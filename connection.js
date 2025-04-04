// connection.js
import * as state from './state.js';
import { SIGNALING_SERVER_URL, PEER_CONNECTION_CONFIG } from './constants.js';
import * as ui from './ui/index.js';
import * as crypto from './crypto.js';
import * as fileTransfer from './fileTransfer.js';
// import * as dom from './dom.js'; // Needed for updating UI elements based on WS state
import * as storage from './storage.js'; // Import storage module
import { resetAllConnections } from './state.js'; // Import resetAllConnections
// import { formatBytes } from './utils.js'; // Import formatBytes from utils
import { deriveSharedKey } from './crypto.js';

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

    if (!msg.type || !msg.from) {
         console.warn("Received signaling message without type or origin:", msg);
         return;
    }

    const peerId = msg.from;

    switch (msg.type) {
        case 'offer':
            if (!msg.payload?.sdp) {
                console.warn(`Invalid offer received from ${peerId}:`, msg);
                return;
            }
            console.log(`Received offer from ${peerId}`);
            ui.addSystemMessage(`收到来自 ${state.contacts[peerId]?.name || peerId} 的连接请求...`, peerId);
            handleOffer(peerId, msg.payload.sdp);
            break;

        case 'answer':
            const isExpecting = state.isExpectingAnswerFrom(peerId);
            if (!isExpecting) {
                console.warn(`Received answer from unexpected peer ${peerId}. Current makingOffer state: ${isExpecting}. Ignoring.`);
                return;
            }
             if (!msg.payload?.sdp) {
                console.warn(`Invalid answer received from ${peerId}:`, msg);
                return;
            }
            console.log(`Received answer from ${peerId}`);
            handleAnswer(peerId, msg.payload.sdp);
            break;

        case 'candidate':
            const isActiveOrPending = state.isPeerConnectionActiveOrPending(peerId);
            if (!isActiveOrPending) {
                 console.warn(`Received candidate from unexpected peer ${peerId}. Current connection state: ${state.getConnectionState(peerId)}. Ignoring.`);
                 return;
            }
            if (!msg.payload?.candidate) {
                console.warn(`Invalid candidate received from ${peerId}:`, msg);
                return;
            }
            console.log(`Received ICE candidate from ${peerId}`);
            handleCandidate(peerId, msg.payload.candidate);
            break;

        case 'error':
            const errorMsg = msg.payload?.message || '未知错误';
            const targetPeerIdOnError = msg.payload?.targetUserId || peerId;
            console.error(`Received error from signaling server regarding ${targetPeerIdOnError}: ${errorMsg}`);
            ui.addSystemMessage(`信令服务器错误 (${state.contacts[targetPeerIdOnError]?.name || targetPeerIdOnError}): ${errorMsg}`, targetPeerIdOnError, true);

            if (errorMsg.includes("not found") || errorMsg.includes("offline")) {
                 ui.addSystemMessage(`目标用户 ${state.contacts[targetPeerIdOnError]?.name || targetPeerIdOnError} 未找到或离线。`, targetPeerIdOnError, true);
                 resetPeerConnection(targetPeerIdOnError);
                 state.updateContactStatus(targetPeerIdOnError, false);
                 ui.updateContactStatusUI(targetPeerIdOnError, false);
            } else {
                 resetPeerConnection(targetPeerIdOnError);
                 state.updateContactStatus(targetPeerIdOnError, false);
                 ui.updateContactStatusUI(targetPeerIdOnError, false);
            }
            break;

        case 'busy':
             const busyPeerId = peerId;
             console.log(`Peer ${busyPeerId} is busy.`);
             ui.addSystemMessage(`${state.contacts[busyPeerId]?.name || busyPeerId} 当前正忙，请稍后再试。`, busyPeerId, true);
             resetPeerConnection(busyPeerId);
             state.updateContactStatus(busyPeerId, false);
             ui.updateContactStatusUI(busyPeerId, false);
             break;

        case 'user_disconnected':
             const disconnectedUserId = msg.payload?.userId;
             if (disconnectedUserId) {
                 console.log(`Signaling server indicated ${disconnectedUserId} disconnected.`);
                 if (state.isPeerConnectionActiveOrPending(disconnectedUserId)) {
                     ui.addSystemMessage(`与 ${state.contacts[disconnectedUserId]?.name || disconnectedUserId} 的连接已断开。`, disconnectedUserId);
                     resetPeerConnection(disconnectedUserId);
                 }
                 state.updateContactStatus(disconnectedUserId, false);
                 ui.updateContactStatusUI(disconnectedUserId, false);
             }
            break;

        default:
            console.log("Received unhandled signaling message type:", msg.type);
    }
}

// --- NEW: Handle WebSocket disconnection logic ---
function handleWebSocketDisconnection(reason) {
    console.log(`WebSocket disconnected. Reason: ${reason}. Resetting all connections.`);
    // Display message only if not already disconnected
    if (state.ws !== null) { // Check if ws was previously set
        ui.addSystemMessage(`与信令服务器的连接已断开 (${reason})。`, null, true);
    }
    state.setWs(null);
    state.resetAllConnections(); // Reset state first
    // Update UI for all contacts AFTER state is reset
    Object.keys(state.contacts).forEach(peerId => {
         // updateContactStatusUI should reflect the new offline state set by resetAllConnections
         ui.updateContactStatusUI(peerId, false); // Explicitly set UI to offline
    });
    ui.updateChatInputVisibility(); // Update input visibility based on potentially cleared active chat
}
// --- END NEW ---

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
        // ui.addSystemMessage("无法连接到信令服务器，请检查服务器状态和网络连接。", true); // Moved message to handler
        // state.setWs(null);
        // state.resetAllConnections();
        // Object.keys(state.contacts).forEach(peerId => {
        //      state.updateContactStatus(peerId, false);
        //      ui.updateContactStatusUI(peerId, false);
        // });
        //  ui.updateChatInputVisibility();
        handleWebSocketDisconnection("错误");
    };

    newWs.onclose = (event) => {
        console.log(`WebSocket connection closed: Code=${event.code}, Reason='${event.reason}'`);
        // if (!event.wasClean && !state.isConnected) {
        //      ui.addSystemMessage("与信令服务器的连接意外断开。", true);
        // } else if (!state.isConnected) {
        // }

        // state.setWs(null);
        // state.resetAllConnections();
        //  Object.keys(state.contacts).forEach(peerId => {
        //      state.updateContactStatus(peerId, false);
        //      ui.updateContactStatusUI(peerId, false);
        // });
        // ui.updateChatInputVisibility();
        const reason = event.wasClean ? "正常关闭" : "意外断开";
        handleWebSocketDisconnection(reason);
    };
}

// --- WebRTC Logic ---

function createPeerConnection(peerId) {
    console.log(`Attempting to create PeerConnection for peer: ${peerId}`);

    console.log("Creating new PeerConnection with config:", PEER_CONNECTION_CONFIG);
    try {
        const newPc = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
        state.setPeerConnection(peerId, newPc);
        setupPeerConnectionEvents(peerId, newPc);
        return newPc;
    } catch (e) {
        console.error(`Failed to create PeerConnection for ${peerId}:`, e);
        ui.addSystemMessage(`创建与 ${state.contacts[peerId]?.name || peerId} 的 PeerConnection 失败。`, peerId, true);
        console.log(`[RESET CALL] Triggered by: createPeerConnection catch block for ${peerId}`);
        resetPeerConnection(peerId);
        state.updateContactStatus(peerId, false);
        ui.updateContactStatusUI(peerId, false);
        return null;
    }
}

function setupPeerConnectionEvents(peerId, pc) {
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`Generated ICE candidate for ${peerId}`);
            const candidateMsg = {
                type: 'candidate',
                payload: {
                    targetUserId: peerId,
                    candidate: event.candidate
                }
            };
            sendSignalingMessage(candidateMsg);
        } else {
            console.log(`ICE gathering finished for ${peerId}.`);
        }
    };

    // --- NEW: Handle PeerConnection failure/closure ---
    function handlePeerConnectionFailure(peerId, stateType, newState) {
        console.log(`[PC Failure Handler] Peer: ${peerId}, State Type: ${stateType}, New State: ${newState}`);
        // Avoid redundant resets if already handled
        if (state.getConnectionState(peerId) === 'closed' || state.getConnectionState(peerId) === 'failed') {
            console.log(`[PC Failure Handler] Ignoring ${newState} for ${peerId}, already closed/failed.`);
            return;
        }

        let message = `与 ${state.contacts[peerId]?.name || peerId} 的连接`;
        let isError = false;

        if (newState === 'failed') {
            message += ` 失败 (${stateType})。`;
            isError = true;
        } else if (newState === 'disconnected') {
            message += ` 中断 (${stateType})。可能尝试重连...`;
            // isError = false; // Not strictly an error, but signifies disruption
        } else if (newState === 'closed') {
            message += ` 已关闭 (${stateType})。`;
            // isError = false;
        }

        ui.addSystemMessage(message, peerId, isError);
        console.log(`[RESET CALL] Triggered by: ${stateType} state '${newState}' for ${peerId}`);
        // resetPeerConnection will call state.resetPeerState and update UI status
        resetPeerConnection(peerId, `${stateType} state ${newState}`);
        // Explicitly ensure UI is offline, resetPeerConnection might be asynchronous or UI update delayed?
        // state.updateContactStatus(peerId, false); // Let resetPeerConnection handle state update
        // ui.updateContactStatusUI(peerId, false); // Let resetPeerConnection handle UI update
    }
    // --- END NEW ---

    pc.oniceconnectionstatechange = () => {
        if (!pc) return;
        const currentState = pc.iceConnectionState;
        console.log(`ICE connection state for ${peerId} changed to: ${currentState}`);
        state.updateIceConnectionState(peerId, currentState);

        switch (currentState) {
            case 'checking':
                break;
            case 'connected':
                 console.log(`ICE connected for ${peerId}. Waiting for data channel.`);
                break;
            case 'completed':
                console.log(`ICE connection completed for ${peerId}.`);
                break;
            case 'failed':
            case 'disconnected':
            case 'closed':
                handlePeerConnectionFailure(peerId, 'ICE', currentState);
                // console.error(`ICE connection failed for ${peerId}.`);
                // ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接失败 (ICE)。`, peerId, true);
                // console.log(`[RESET CALL] Triggered by: oniceconnectionstatechange 'failed' for ${peerId}`);
                // resetPeerConnection(peerId);
                //  state.updateContactStatus(peerId, false);
                //  ui.updateContactStatusUI(peerId, false);
                break;
            // case 'disconnected':
            //     console.log(`ICE connection disconnected for ${peerId}. May reconnect...`);
            //     ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接中断 (ICE)。可能尝试重连...`, peerId);
            //     state.updateContactStatus(peerId, false);
            //     ui.updateContactStatusUI(peerId, false);
            //     break;
            // case 'closed':
            //     console.log(`ICE connection closed for ${peerId}.`);
            //     if (state.getConnectionState(peerId) !== 'closed' && state.getConnectionState(peerId) !== 'failed') {
            //         console.log(`[RESET CALL] Triggered by: oniceconnectionstatechange 'closed' for ${peerId}`);
            //         resetPeerConnection(peerId);
            //     }
            //      state.updateContactStatus(peerId, false);
            //      ui.updateContactStatusUI(peerId, false);
            //     break;
        }
    };

    pc.onconnectionstatechange = () => {
        if (!pc) return;
        const overallState = pc.connectionState;
         console.log(`Overall connection state for ${peerId} changed to: ${overallState}`);
         state.updateOverallConnectionState(peerId, overallState);

        switch (overallState) {
            case 'new':
            case 'connecting':
                break;
            case 'connected':
                 console.log(`Overall connection established for ${peerId}.`);
                 const dc = state.getDataChannel(peerId);
                 if (dc?.readyState === 'open') {
                    state.updateContactStatus(peerId, true);
                    ui.updateContactStatusUI(peerId, true);
                 } else {
                    state.updateContactStatus(peerId, 'connecting');
                    ui.updateContactStatusUI(peerId, 'connecting');
                 }

                break;
            case 'failed':
            case 'disconnected':
            case 'closed':
                 handlePeerConnectionFailure(peerId, 'Overall', overallState);
                // console.error(`Overall connection failed for ${peerId}.`);
                //  ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接失败。`, peerId, true);
                // console.log(`[RESET CALL] Triggered by: onconnectionstatechange 'failed' for ${peerId}`);
                // resetPeerConnection(peerId);
                //  state.updateContactStatus(peerId, false);
                //  ui.updateContactStatusUI(peerId, false);
                // break;
            // case 'disconnected':
            //      console.log(`Overall connection disconnected for ${peerId}.`);
            //     ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接中断。`, peerId);
            //     console.log(`[RESET CALL] Triggered by: onconnectionstatechange 'disconnected' for ${peerId}`);
            //     resetPeerConnection(peerId);
            //      state.updateContactStatus(peerId, false);
            //      ui.updateContactStatusUI(peerId, false);
            //     break;
            // case 'closed':
            //      console.log(`Overall connection closed for ${peerId}.`);
            //     if (state.getConnectionState(peerId) !== 'closed') {
            //         console.log(`[RESET CALL] Triggered by: onconnectionstatechange 'closed' for ${peerId}`);
            //         resetPeerConnection(peerId);
            //     }
            //      state.updateContactStatus(peerId, false);
            //      ui.updateContactStatusUI(peerId, false);
            //     break;
        }
    };

    pc.ondatachannel = (event) => {
        console.log(`Data channel received from ${peerId}: ${event.channel.label}`);
        const dc = event.channel;
         state.setDataChannel(peerId, dc);

        setupDataChannelEvents(peerId, dc);

        if (pc.connectionState === 'connected') {
             state.updateContactStatus(peerId, true);
             ui.updateContactStatusUI(peerId, true);
        }
    };

     pc.onsignalingstatechange = () => {
         if (!pc) return;
         console.log(`Signaling state for ${peerId} changed to: ${pc.signalingState}`);
         state.updateSignalingState(peerId, pc.signalingState);
         if (pc.signalingState === 'closed') {
              console.log(`Signaling state closed for ${peerId}. Ensuring cleanup.`);
              if (state.getConnectionState(peerId) !== 'closed' && state.getConnectionState(peerId) !== 'failed') {
                  console.log(`[RESET CALL] Triggered by: onsignalingstatechange 'closed' for ${peerId}`);
                  resetPeerConnection(peerId);
              }
         }
     };
}

async function setupDataChannelEvents(peerId, dc) {
    console.log(`Setting up data channel (${dc.label}) events for peer: ${peerId}`);

    dc.onopen = async () => {
        console.log(`[General Handler] Data channel opened for peer ${peerId}`);
        state.updateDataChannelState(peerId, 'open');

        const pc = state.getPeerConnection(peerId);
        if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'completed')) {
           state.updateContactStatus(peerId, true);
           ui.updateContactStatusUI(peerId, true);
           if (state.isActiveChat(peerId)) {
                 ui.updateChatInputVisibility();
           }
           // Don't show "secure connection" message here yet, wait for friend acceptance?
           // ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的安全连接已建立。`, peerId);
        } else {
             console.warn(`Data channel for ${peerId} opened, but overall connection state is ${pc?.connectionState}. Waiting.`);
             state.updateContactStatus(peerId, 'connecting');
             ui.updateContactStatusUI(peerId, 'connecting');
        }

        // --- NEW: Send Public Key on Data Channel Open ---
        if (state.localKeyPair && state.localKeyPair.publicKey) {
            try {
                const publicKeyJwk = await crypto.exportPublicKey(state.localKeyPair.publicKey);
                if (publicKeyJwk) {
                    const keyMessage = {
                        type: 'publicKey',
                        payload: { jwk: publicKeyJwk }
                    };
                    await sendP2PMessage(peerId, keyMessage);
                    console.log(`Sent public key to ${peerId}`);
                } else {
                     console.error(`Failed to export local public key for sending to ${peerId}.`);
                     // Consider adding a system message or other error handling
                     ui.addSystemMessage(`无法导出本地公钥以发送给 ${state.contacts[peerId]?.name || peerId}。`, peerId, true);
                }
            } catch (error) {
                console.error(`Error exporting or sending public key to ${peerId}:`, error);
                 ui.addSystemMessage(`发送公钥给 ${state.contacts[peerId]?.name || peerId} 时出错。`, peerId, true);
            }
        } else {
             console.warn(`Cannot send public key to ${peerId}: Local key pair not available.`);
             ui.addSystemMessage(`无法发送公钥：本地密钥对不可用。`, peerId, true);
        }
        // --- END NEW --- 

        // --- Send Profile Info on Open --- // 
        console.log(`[Connection dc.onopen] Data channel open for ${peerId}. Attempting to send profile info.`); // <-- ADD LOG
        sendProfileInfo(peerId); // Call the function to send profile info
        // --- END --- //
    };

    dc.onclose = () => {
        console.log(`[General Handler] Data channel closed for peer ${peerId}`);
         state.updateDataChannelState(peerId, 'closed');
         // Don't show message if it was closed due to friend decline/completion?
         // ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的数据通道已关闭。`, peerId);
        console.log(`[RESET CALL] Triggered by: dc.onclose for ${peerId}`);
        resetPeerConnection(peerId);
         state.updateContactStatus(peerId, false);
         ui.updateContactStatusUI(peerId, false);
          if (state.isActiveChat(peerId)) {
                 ui.updateChatInputVisibility();
           }
    };

    dc.onerror = (error) => {
        console.error(`[General Handler] Data channel error for peer ${peerId}:`, error);

        // Check if it's the specific "User-Initiated Abort" error after successful transfer
        const isKnownAbortError = error instanceof RTCErrorEvent &&
                                 error.error &&
                                 error.error.name === 'OperationError' &&
                                 error.error.message.includes('User-Initiated Abort');
                                // error.reason?.includes('Close called'); // Browser support for reason might vary

        if (isKnownAbortError) {
            console.warn(`[dc.onerror] Ignoring specific 'User-Initiated Abort' error for ${peerId} as transfer likely completed successfully.`);
            // Optional: Maybe update UI slightly or just log. Don't reset.
            // ui.addSystemMessage(`数据通道 ${peerId} 报告了一个关闭事件（可能无害）。`, peerId);
            // We might not even need to update status to offline here, connection might still be usable.
        } else {
            // For all other unknown errors, reset the connection
            ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的数据通道发生错误，正在重置连接。`, peerId, true);
            console.log(`[RESET CALL] Triggered by: dc.onerror (non-abort error) for ${peerId}`);
            resetPeerConnection(peerId);
            // state.updateContactStatus(peerId, false); // resetPeerConnection handles status updates
            // ui.updateContactStatusUI(peerId, false);
            // if (state.isActiveChat(peerId)) { ... } // resetPeerConnection handles UI update
        }
        // Note: We removed the general status update outside the else block,
        // because for the ignored error, we don't necessarily want to mark as offline.
        // resetPeerConnection handles setting status to offline for real errors.
    };

    dc.onmessage = async (event) => {
        // Check if data is ArrayBuffer (binary)
        if (event.data instanceof ArrayBuffer) {
            console.log(`[${peerId}] Received binary data (chunk). Length: ${event.data.byteLength}`);
            // Process the chunk using fileTransfer module
            const result = fileTransfer.handleIncomingDataChunk(peerId, event.data);

            // Check if the file transfer is complete based on the return value
            if (result?.completed && result.fileInfo) {
                console.log(`[${peerId}] File transfer ${result.fileInfo.id} completed. Sending ACK.`);
                sendFileAck(peerId, result.fileInfo.id);
            } else if (result === null) {
                console.error(`[${peerId}] handleIncomingDataChunk returned null, indicating an error during processing.`);
                // Optionally add system message or specific error handling
            } // No else needed if result.completed is false, just means more chunks are expected

        } else if (typeof event.data === 'string') {
            console.log(`Raw message received from ${peerId} on channel ${dc.label}`);
            try {
                let parsedMessage;
                let messageType = 'unknown';
                let payload = {};
                let originalSenderId = peerId; // Keep track of the original sender

                // Process string data
                if (typeof event.data === 'string') {
                    try {
                        parsedMessage = JSON.parse(event.data);

                        // --- DECRYPTION --- 
                        if (parsedMessage && parsedMessage.type === 'encrypted') {
                            console.log(`Received encrypted message wrapper from ${peerId}`);
                            const keys = state.getPeerKeys(peerId);
                            if (keys && keys.sharedKey) {
                                try {
                                    const decryptedJsonString = await crypto.decryptMessage(peerId, parsedMessage.payload);
                                    // Re-parse the decrypted JSON string
                                    parsedMessage = JSON.parse(decryptedJsonString);
                                    console.log(`Decrypted message. Original type: ${parsedMessage?.type}`);
                                } catch (decryptionError) {
                                    console.error(`Failed to decrypt message from ${peerId}:`, decryptionError);
                                    ui.addSystemMessage(`无法解密来自 ${state.contacts[peerId]?.name || peerId} 的消息。`, peerId, true);
                                    // Should we return or try to process as plaintext? Return seems safer.
                                    return;
                                }
                            } else {
                                 console.warn(`Received encrypted message from ${peerId}, but no shared key available. Ignoring.`);
                                 ui.addSystemMessage(`收到来自 ${state.contacts[peerId]?.name || peerId} 的加密消息，但无法解密（无密钥）。`, peerId, true);
                                 return;
                            }
                        }
                        // --- END DECRYPTION ---

                        // Now process the potentially decrypted parsedMessage
                        if (parsedMessage && typeof parsedMessage === 'object' && parsedMessage.type) {
                            messageType = parsedMessage.type;
                            payload = parsedMessage.payload || {};
                            // Log the type AFTER potential decryption
                            console.log(`Processing structured message of type: ${messageType} from ${peerId}`);
                        } else {
                            // Treat as plain text if JSON parsing doesn't yield a type, or if original wasn't JSON
                            // This should be less common now with encryption wrapper
                            messageType = 'text';
                            payload = { text: (typeof parsedMessage === 'string' ? parsedMessage : event.data) }; // Use original data if parsing failed
                            console.log(`Received plain text string or non-standard JSON from ${peerId}, wrapping.`);
                        }
                    } catch (e) {
                        // If JSON parsing fails initially (and it wasn't an encrypted wrapper)
                        messageType = 'text';
                        payload = { text: event.data };
                        console.log(`Received non-JSON string from ${peerId}, wrapping.`);
                    }
                } else {
                    console.warn(`Received message of unknown type from ${peerId}:`, typeof event.data);
                    return; // Ignore unknown types
                }

                // --- Process based on messageType --- //
                switch (messageType) {
                    case 'text':
                         // --- NEW: Check if sender is a contact --- 
                         if (!state.contacts[originalSenderId]) {
                             console.warn(`Received text message from non-contact ${originalSenderId}. Ignoring and sending error.`);
                             sendNotFriendError(originalSenderId); // Send feedback
                             return; // Stop processing
                         }
                         // --- END NEW ---

                         // Decryption already happened if it was encrypted
                        const messageToStore = {
                            id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                            senderId: originalSenderId, // Use originalSenderId here
                            peerId: originalSenderId, // Use originalSenderId here
                            type: 'text',
                            payload: { text: payload.text }, // Ensure payload structure is consistent
                            timestamp: payload.timestamp || Date.now() // Timestamp might be from encrypted payload
                        };
                        await storage.addMessage(messageToStore);
                        console.log(`Stored text message from ${originalSenderId}:`, messageToStore);
                        if (state.isActiveChat(originalSenderId)) {
                            ui.displayMessage(originalSenderId, messageToStore);
                        } else {
                            ui.showUnreadIndicator(originalSenderId, true);
                        }
                        break;

                    // Other cases (fileMeta, typing, publicKey, friend_request, etc.)
                    // These are generally expected to be sent *before* shared key is established
                    // or are metadata that might not need encryption (like typing).
                    // publicKey MUST NOT be encrypted.
                    // For now, assume others are plaintext.

                    case 'fileMeta':
                         // --- NEW: Check if sender is a contact --- 
                         if (!state.contacts[originalSenderId]) {
                             console.warn(`Received fileMeta from non-contact ${originalSenderId}. Ignoring and sending error.`);
                             sendNotFriendError(originalSenderId); // Send feedback
                             return; // Stop processing
                         }
                         // --- END NEW ---

                        // Should fileMeta be encrypted? For now, assuming no.
                        const fileInfo = payload;
                        const messageForUi = {
                            id: fileInfo.transferId || `file-${Date.now()}`,
                            senderId: originalSenderId,
                            peerId: originalSenderId,
                            type: 'fileMeta',
                            payload: fileInfo,
                            timestamp: payload.timestamp || fileInfo.timestamp || Date.now()
                        };
                        await storage.addMessage(messageForUi);
                        ui.displayMessage(originalSenderId, messageForUi);
                        ui.showUnreadIndicator(originalSenderId, true);
                        fileTransfer.handleIncomingFileMeta(originalSenderId, fileInfo);
                        break;

                    case 'typing':
                        // Typing indicators are low-value, maybe don't encrypt?
                        console.log(`Received typing indicator from ${originalSenderId}:`, payload.isTyping);
                        ui.showTypingIndicator(originalSenderId, payload.isTyping);
                        break;

                    case 'publicKey':
                        // Public key MUST be received in plaintext
                        if (payload.jwk) {
                            console.log(`Received public key from ${originalSenderId}`);
                            await crypto.handlePublicKey(originalSenderId, payload.jwk);
                        } else {
                            console.warn(`Received invalid publicKey message from ${originalSenderId}: Missing jwk in payload.`);
                        }
                        break;

                    // Friend requests and responses - assumed plaintext for now
                    case 'friend_request':
                        console.log(`[Friend Request] Received friend_request from ${originalSenderId}:`, payload);
                        // Validate payload basics
                        if (!payload.senderId || payload.senderId !== originalSenderId) {
                            console.warn(`[Friend Request] Invalid senderId in request from ${originalSenderId}. Ignoring.`);
                            return;
                        }
                        // Check if we already sent a request to them
                        if (state.hasPendingOutgoingRequest(originalSenderId)) {
                            console.log(`[Friend Request] Received request from ${originalSenderId}, to whom we already sent a request. Auto-accepting?`);
                        }

                        // Store incoming request state
                        const requestData = {
                            id: originalSenderId,
                            name: payload.senderName || originalSenderId,
                            timestamp: payload.timestamp || Date.now()
                        };
                        state.addPendingIncomingRequest(requestData);

                        // --- NEW: Add contact to main state with pending status ---
                        state.addContact(originalSenderId, requestData.name, 'pending_incoming');
                        // --- END NEW ---

                        // Notify UI
                        ui.renderContactList(); // Re-render to potentially show incoming request indicator
                        ui.addSystemMessage(`${requestData.name} 请求添加您为好友。`, null); // Global notification for now
                        break;

                    case 'friend_accept':
                        console.log(`[Friend Request] Received friend_accept from ${originalSenderId}:`, payload);
                        // Validate payload
                        if (!payload.acceptorId || payload.acceptorId !== originalSenderId) {
                            console.warn(`[Friend Request] Invalid acceptorId in accept message from ${originalSenderId}. Ignoring.`);
                            return;
                        }
                        // Check if we actually sent a request
                        if (!state.hasPendingOutgoingRequest(originalSenderId)) {
                            console.warn(`[Friend Request] Received unexpected accept from ${originalSenderId}. Ignoring.`);
                            return;
                        }
                        // Process acceptance
                        state.removePendingOutgoingRequest(originalSenderId);
                        const acceptorName = payload.acceptorName || originalSenderId;
                        // state.addContact(originalSenderId, acceptorName); // Add as contact // <-- REMOVE or COMMENT OUT this line

                        // --- NEW: Explicitly set friend status to confirmed ---
                        state.setContactFriendStatus(originalSenderId, 'confirmed');
                        // Optionally update name if different (addContact logic moved here if needed)
                        if (state.contacts[originalSenderId] && state.contacts[originalSenderId].name !== acceptorName) {
                            state.contacts[originalSenderId].name = acceptorName;
                            state.saveContacts(); // Make sure to save if name is updated
                            console.log(`[Friend Accept] Updated name for ${originalSenderId} to ${acceptorName}`);
                        }
                        // --- END NEW ---

                        // Update UI
                        ui.renderContactList(); // Re-render to show as full contact
                        ui.addSystemMessage(`${acceptorName} 已接受您的好友请求。`, null);

                        // --- MODIFIED: Explicitly update UI status and switch chat ---
                        ui.updateContactStatusUI(originalSenderId, 'connecting'); // Assume connecting first
                        // Don't switch chat automatically here, let user decide
                        // await ui.switchToChat(originalSenderId); // Let user click if they want to chat now

                        // Attempt connection after receiving acceptance
                        connectToPeer(originalSenderId)
                            .then(dc => {
                                // Connection successful (or already existed), ensure UI is fully online
                                console.log(`[Friend Accept] connectToPeer successful for ${originalSenderId}. Ensuring UI is online.`);
                                ui.updateContactStatusUI(originalSenderId, true);
                                if (state.isActiveChat(originalSenderId)) { // Update input only if active
                                    ui.updateChatInputVisibility();
                                }
                            })
                            .catch(err => {
                                console.error(`[Friend Accept] connectToPeer failed for ${originalSenderId} after acceptance:`, err);
                                // Show error and potentially mark offline
                                ui.addSystemMessage(`尝试自动连接到 ${acceptorName} 失败: ${err.message}`, originalSenderId, true);
                                ui.updateContactStatusUI(originalSenderId, false);
                                if (state.isActiveChat(originalSenderId)) { // Update input only if active
                                    ui.updateChatInputVisibility();
                                }
                            });
                        // --- END MODIFICATION ---
                        break;

                    case 'friend_decline':
                        console.log(`[Friend Request] Received friend_decline from ${originalSenderId}:`, payload);
                         // Validate payload
                        if (!payload.declinerId || payload.declinerId !== originalSenderId) {
                            console.warn(`[Friend Request] Invalid declinerId in decline message from ${originalSenderId}. Ignoring.`);
                            return;
                        }
                        // Check if we actually sent a request
                        if (!state.hasPendingOutgoingRequest(originalSenderId)) {
                            console.warn(`[Friend Request] Received unexpected decline from ${originalSenderId}. Ignoring.`);
                            return;
                        }
                        // Process decline
                        state.removePendingOutgoingRequest(originalSenderId);
                        // --- NEW: Also remove the contact from the main contacts list ---
                        state.removeContact(originalSenderId);
                        // --- END NEW ---

                        // Update UI
                        ui.renderContactList(); // Re-render to remove pending state
                        ui.addSystemMessage(`${state.contacts[originalSenderId]?.name || originalSenderId} 已拒绝您的好友请求。`, null);

                        // Optional: Disconnect if still connected
                        disconnectFromPeer(originalSenderId);
                        break;

                    // --- NEW: Handle Friend Request Cancellation ---
                    case 'friend_cancel':
                        console.log(`[Friend Request] Received friend_cancel from ${originalSenderId}:`, payload);
                        // Validate payload
                        if (!payload.cancellerId || payload.cancellerId !== originalSenderId) {
                            console.warn(`[Friend Request] Invalid cancellerId in cancel message from ${originalSenderId}. Ignoring.`);
                            return;
                        }
                        // Check if we have a pending incoming request from this user
                        if (!state.hasPendingIncomingRequest(originalSenderId)) {
                             console.warn(`[Friend Request] Received unexpected cancel from ${originalSenderId} (no pending incoming request found). Ignoring.`);
                             return;
                        }

                        // Process cancellation
                        const removed = state.removePendingIncomingRequest(originalSenderId); // Remove from state
                        if (removed) {
                            console.log(`[Friend Request] Removed pending incoming request from ${originalSenderId} due to cancellation.`);
                            // --- NEW: Also remove the contact from the main contacts list --- 
                            state.removeContact(originalSenderId);
                            // --- END NEW ---
                            ui.renderContactList(); // Re-render the entire list instead
                            ui.addSystemMessage(`${state.contacts[originalSenderId]?.name || originalSenderId} 已取消其好友请求。`, null);
                        } else {
                             console.warn(`[Friend Request] State indicates pending request from ${originalSenderId} exists, but removal failed.`);
                             // Might need a full UI re-render as fallback
                             ui.renderContactList();
                        }
                        break;
                    // --- END NEW ---

                    // --- NEW: Handle File Acknowledgement ---
                    case 'file_ack':
                        if (payload.transferId) {
                            console.log(`Received file ACK for transfer ${payload.transferId} from ${originalSenderId}`);
                            // Update UI for the sender to show the file was received.
                            // We need a new UI function for this.
                            ui.updateFileMessageStatusToReceived(originalSenderId, payload.transferId);
                        } else {
                            console.warn(`Received invalid file_ack from ${originalSenderId}: Missing transferId.`);
                        }
                        break;
                    // --- END NEW ---

                    // --- NEW: Handle Not Friend Error --- 
                    case 'not_friend_error':
                        console.log(`Received 'not_friend_error' from ${originalSenderId}`);
                        // Extract receiverId if needed, or just use originalSenderId
                        handlePeerRemovedUs(originalSenderId); // NEW: Call dedicated handler
                        break;
                    // --- END NEW ---

                    // --- NEW: Handle Profile Info --- //
                    case 'profile_info':
                        console.log(`[Profile] Received profile info from ${originalSenderId}:`, payload);
                        if (payload && (payload.nickname || payload.avatar)) {
                            const updated = state.updateContactDetails(originalSenderId, {
                                nickname: payload.nickname,
                                avatar: payload.avatar
                            });
                            console.log(`[Profile] state.updateContactDetails returned: ${updated}`);
                            if (updated) {
                                console.log(`[Profile] Updated contact details for ${originalSenderId}. Triggering UI update.`);
                                // Re-render the entire contact list to show the updated name/avatar
                                ui.renderContactList(); 
                                // If this chat is currently active, also update the chat header
                                if (state.isActiveChat(originalSenderId)) {
                                    ui.updateChatHeader(originalSenderId);
                                }
                            } else {
                                 console.log(`[Profile] Received profile info for ${originalSenderId}, but no changes were applied.`);
                            }
                        } else {
                            console.warn(`[Profile] Received profile_info message from ${originalSenderId} with invalid payload:`, payload);
                        }
                        break;
                    // --- END NEW --- //

                    default:
                        console.log(`Received unhandled structured message type: ${messageType} from ${originalSenderId}`);
                        break;
                }

            } catch (e) {
                console.error(`Error processing message from ${originalSenderId}:`, e);
                 ui.addSystemMessage(`处理来自 ${state.contacts[originalSenderId]?.name || originalSenderId} 的消息时出错。`, originalSenderId, true);
            }
        } else {
            console.warn(`Received message of unknown type from ${peerId}:`, typeof event.data);
            return; // Ignore unknown types
        }
    };
}

async function handleOffer(peerId, offerSdp) {
    console.log(`Handling offer for peer: ${peerId}`);
    const pc = createPeerConnection(peerId);

    if (!pc) {
        console.error(`Failed to get/create PeerConnection for ${peerId}`);
        return;
    }

    const perfectNegotiation = false;
    const makingOffer = state.isMakingOffer(peerId);
    const ignoreOffer = perfectNegotiation && makingOffer || pc.signalingState !== "stable";

    if (ignoreOffer) {
        console.log(`Ignoring offer from ${peerId} due to signaling state: ${pc.signalingState} or making offer flag.`);
        return;
    }

    try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
        console.log(`Remote description (offer) set for peer ${peerId}`);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`Local description (answer) set for peer ${peerId}`);

        const answerMsg = {
            type: 'answer',
            payload: {
                targetUserId: peerId,
                sdp: pc.localDescription.sdp
            }
        };
        sendSignalingMessage(answerMsg);
        console.log(`Sent answer to ${peerId}`);
        state.updateConnectionState(peerId, 'connecting');
        ui.updateContactStatusUI(peerId, 'connecting');

    } catch (e) {
        console.error(`Error handling offer from ${peerId}:`, e);
        resetPeerConnection(peerId);
    }
}

async function handleAnswer(peerId, answerSdp) {
    console.log(`Handling answer for peer: ${peerId}`);
    const pc = state.getPeerConnection(peerId);

    if (!pc) {
        console.error(`No PeerConnection found for peer ${peerId} when handling answer.`);
        return;
    }

    if (pc.signalingState !== 'have-local-offer') {
         console.warn(`Received answer from ${peerId}, but signaling state is ${pc.signalingState}. Ignoring.`);
         return;
    }

    try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
        console.log(`Remote description (answer) set for peer ${peerId}`);
    } catch (e) {
        console.error(`Error handling answer from ${peerId}:`, e);
        resetPeerConnection(peerId);
    }
}

async function handleCandidate(peerId, candidate) {
     console.log(`Handling ICE candidate for peer: ${peerId}`);
    const pc = state.getPeerConnection(peerId);

    if (!pc) {
        console.error(`No PeerConnection found for peer ${peerId} when handling candidate.`);
        return;
    }

    if (!candidate) {
        console.log(`Received null candidate for ${peerId}, signaling end-of-candidates.`);
        return;
    }

    try {
        if (!pc.remoteDescription) {
             console.warn(`PeerConnection for ${peerId} has no remote description yet. Queuing candidate? (Not implemented)`);
             return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
         console.log(`Added ICE candidate for peer ${peerId}`);
    } catch (e) {
        if (pc.signalingState !== 'closed') {
            console.error(`Error adding ICE candidate for ${peerId}:`, e);
        }
    }
}

// --- Public Connection Functions ---

// --- REVISED connectToPeer function --- returns Promise<RTCDataChannel>
export function connectToPeer(targetPeerId) {
    return new Promise(async (resolve, reject) => {
        // 1. Pre-checks
        if (!targetPeerId) {
            return reject(new Error("connectToPeer called without targetPeerId"));
        }
        const currentState = state.getConnectionState(targetPeerId);
        if (currentState === 'connected') {
            const existingDc = state.getDataChannel(targetPeerId);
            if (existingDc && existingDc.readyState === 'open') {
                console.log(`connectToPeer: Already connected with open DC to ${targetPeerId}. Resolving immediately.`);
                return resolve(existingDc);
            } else {
                 console.log(`connectToPeer: State is connected but DC not open for ${targetPeerId}. Resetting and re-connecting.`);
                 // Proceed to reset and connect below
            }
        } else if (currentState === 'connecting') {
             console.log(`connectToPeer: Already attempting to connect to ${targetPeerId}. Rejecting new attempt.`);
            return reject(new Error(`Already connecting to ${targetPeerId}.`));
        }

        console.log(`connectToPeer: Attempting connection to peer: ${targetPeerId}`);

        // 2. Reset state for this specific attempt
        resetPeerConnection(targetPeerId, "Connect Attempt Start");

        // 3. Setup Timeout & Cleanup Function
        let timeoutId = null;
        let isCleanupCalled = false; // Prevent multiple calls

        const cleanup = (reason, error = null) => {
            if (isCleanupCalled) return;
            isCleanupCalled = true;
            console.log(`[connectToPeer Cleanup] Reason: ${reason} for ${targetPeerId}`);
            clearTimeout(timeoutId); // Clear timeout
            // Remove specific listeners added by this promise? If pc/dc are GC'd, listeners should go too.
            // Relying on resetPeerConnection to handle closing pc/dc.
            if (error) {
                reject(error); // Reject the main promise
            }
        };

        timeoutId = setTimeout(() => {
            const timeoutError = new Error(`Connection to ${targetPeerId} timed out.`);
            console.log(`[connectToPeer Timeout] ${timeoutError.message}`);
            ui.addSystemMessage(`连接 ${state.contacts[targetPeerId]?.name || targetPeerId} 超时。`, targetPeerId, true);
            resetPeerConnection(targetPeerId, "Connection Timeout");
            cleanup("Timeout", timeoutError);
        }, 30000); // 30 seconds

        // 4. Set initial UI/State
        ui.addSystemMessage(`正在尝试连接到 ${state.contacts[targetPeerId]?.name || targetPeerId}...`, targetPeerId);
        state.updateContactStatus(targetPeerId, 'connecting');
        state.updateConnectionState(targetPeerId, 'connecting');
        state.setIsMakingOffer(targetPeerId, true);

        // 5. Create PeerConnection
        const pc = createPeerConnection(targetPeerId);
        if (!pc) {
            const creationError = new Error(`Failed to create PeerConnection for ${targetPeerId}`);
            // resetPeerConnection was called inside createPeerConnection
            cleanup("PC Creation Failed", creationError);
            return; // Reject is called by cleanup
        }

        // 6. Add Promise-specific Event Listeners to PC
        const handleIceConnectionFailure = () => {
            if (pc.iceConnectionState === 'failed') {
                const iceError = new Error(`ICE connection failed for ${targetPeerId}.`);
                console.log(`[connectToPeer ICE Fail] ${iceError.message}`);
                ui.addSystemMessage(`与 ${state.contacts[targetPeerId]?.name || targetPeerId} 的连接失败 (ICE)。`, targetPeerId, true);
                resetPeerConnection(targetPeerId, "ICE Failed");
                cleanup("ICE Failed", iceError);
            }
             // Consider closed/disconnected before DC open?
             else if ((pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'disconnected') && state.getDataChannel(targetPeerId)?.readyState !== 'open') {
                 const iceCloseError = new Error(`ICE connection ${pc.iceConnectionState} for ${targetPeerId} before data channel open.`);
                 console.log(`[connectToPeer ICE Close/Disconnect] ${iceCloseError.message}`);
                 resetPeerConnection(targetPeerId, "ICE Closed/Disconnected Early");
                 cleanup("ICE Closed/Disconnected Early", iceCloseError);
             }
        };
        const handleConnectionFailure = () => {
             if (pc.connectionState === 'failed') {
                 const connError = new Error(`Overall connection failed for ${targetPeerId}.`);
                 console.log(`[connectToPeer Conn Fail] ${connError.message}`);
                 ui.addSystemMessage(`与 ${state.contacts[targetPeerId]?.name || targetPeerId} 的连接失败。`, targetPeerId, true);
                 resetPeerConnection(targetPeerId, "Connection Failed");
                 cleanup("Connection Failed", connError);
             }
             // Consider closed/disconnected before DC open?
             else if ((pc.connectionState === 'closed' || pc.connectionState === 'disconnected') && state.getDataChannel(targetPeerId)?.readyState !== 'open') {
                 const connCloseError = new Error(`Overall connection ${pc.connectionState} for ${targetPeerId} before data channel open.`);
                 console.log(`[connectToPeer Conn Close/Disconnect] ${connCloseError.message}`);
                 resetPeerConnection(targetPeerId, "Connection Closed/Disconnected Early");
                 cleanup("Connection Closed/Disconnected Early", connCloseError);
             }
        };
        pc.addEventListener('iceconnectionstatechange', handleIceConnectionFailure);
        pc.addEventListener('connectionstatechange', handleConnectionFailure);

        try {
            // 7. Create Data Channel
            console.log(`Creating data channel for ${targetPeerId}`);
            const dc = pc.createDataChannel('chat', { negotiated: false });
            state.setDataChannel(targetPeerId, dc); // Store it in state
            setupDataChannelEvents(targetPeerId, dc); // Setup general handlers

            // 8. Add Promise-specific Event Listeners to DC
            const handleDcOpen = () => {
                console.log(`[connectToPeer DC Open] Data channel opened for ${targetPeerId}. Resolving promise.`);
                cleanup("DC Open");
                resolve(dc); // Resolve the promise with the open data channel
            };
            const handleDcClose = () => {
                 const closeError = new Error(`Data channel closed for ${targetPeerId} before promise resolved.`);
                 console.log(`[connectToPeer DC Close] ${closeError.message}`);
                 // General handler in setupDataChannelEvents will call resetPeerConnection
                 cleanup("DC Closed Early", closeError);
            };
            const handleDcError = (errorEvent) => {
                 const dcError = new Error(`Data channel error for ${targetPeerId}: ${errorEvent?.error?.message || 'Unknown error'}`);
                 console.error(`[connectToPeer DC Error] ${dcError.message}`, errorEvent);
                 // General handler will also run
                 cleanup("DC Error", dcError);
            };
            dc.addEventListener('open', handleDcOpen);
            dc.addEventListener('close', handleDcClose);
            dc.addEventListener('error', handleDcError);

            // 9. Create and Send Offer
            console.log(`Creating offer for ${targetPeerId}`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log(`Local description (offer) set for ${targetPeerId}`);

            const offerMsg = {
                type: 'offer',
                payload: {
                    targetUserId: targetPeerId,
                    sdp: pc.localDescription.sdp
                }
            };
            sendSignalingMessage(offerMsg);
            console.log(`[CONNECT] Sent offer to ${targetPeerId}`);

        } catch (e) {
            const creationError = new Error(`Error initiating connection sequence for ${targetPeerId}: ${e.message}`);
            console.error(`[connectToPeer Init Error] ${creationError.message}`, e);
            ui.addSystemMessage(`无法发起与 ${state.contacts[targetPeerId]?.name || targetPeerId} 的连接。`, targetPeerId, true);
            resetPeerConnection(targetPeerId, "Connect Initiate Error");
            cleanup("Connect Initiate Error", creationError);
        }
        // Promise resolves/rejects in the event handlers or timeout
    });
}

export function disconnectFromPeer(peerId) {
    if (!peerId) {
         console.warn("disconnectFromPeer called without peerId");
         peerId = state.getActiveChatPeerId();
         if (!peerId) return;
    }
    console.log(`Disconnecting from peer: ${peerId}`);
     const pc = state.getPeerConnection(peerId);

    if (pc) {
        ui.addSystemMessage(`正在断开与 ${state.contacts[peerId]?.name || peerId} 的连接...`, peerId);
        console.log(`[RESET CALL] Triggered by: disconnectFromPeer explicit call for ${peerId}`);
        resetPeerConnection(peerId);
    } else {
        console.log(`No active connection found for peer ${peerId} to disconnect.`);
         state.updateContactStatus(peerId, false);
         ui.updateContactStatusUI(peerId, false);
         state.updateConnectionState(peerId, 'disconnected');
    }
}

export function resetPeerConnection(peerId, reason = "Unknown") {
     if (!peerId) {
         console.warn("resetPeerConnection called without peerId. This might indicate a logic error.");
         return;
     }
    console.log(`[RESET] Resetting connection state for peer: ${peerId}. Reason: ${reason}`);

    // const pc = state.getPeerConnection(peerId);
    // const dc = state.getDataChannel(peerId);

    // if (dc) {
    //     try {
    //         console.log(`Closing data channel for ${peerId}`);
    //         dc.close();
    //     } catch (e) { console.warn(`Error closing data channel for ${peerId}:`, e); }
    //      state.removeDataChannel(peerId);
    // }
    //
    // if (pc) {
    //     try {
    //         console.log(`Closing PeerConnection for ${peerId}`);
    //         pc.close();
    //     } catch (e) { console.warn(`Error closing PeerConnection for ${peerId}:`, e); }
    //      state.removePeerConnection(peerId);
    // }

    // Call state.resetPeerState which handles closing connections and clearing state maps
    state.resetPeerState(peerId);

    // Update UI after state reset
    if (state.isActiveChat(peerId)) {
        ui.updateChatInputVisibility(); // Update based on possibly cleared active chat
    }
     // Ensure UI status is updated to reflect the reset state
     state.updateContactStatus(peerId, false); // State might already be set, but ensures consistency
     ui.updateContactStatusUI(peerId, false);

     console.log(`Finished resetting connection for ${peerId}`);
}

// --- MODIFIED: Send P2P message helper (Added Encryption) ---
async function sendP2PMessage(peerId, messageObject, forcePlaintext = false) { // Made async, added forcePlaintext flag
    const dc = state.getDataChannel(peerId);
    if (dc && dc.readyState === 'open') {
        try {
            // --- ENCRYPTION --- 
            let dataToSend;
            const keys = state.getPeerKeys(peerId);
            // --- MODIFICATION: Define message types NOT to encrypt --- 
            const plaintextMessageTypes = ['publicKey', 'friend_request', 'friend_accept', 'friend_decline', 'friend_cancel', 'not_friend_error']; // Added not_friend_error

            if (!forcePlaintext && keys && keys.sharedKey && !plaintextMessageTypes.includes(messageObject.type)) { // Check flag AND shared key AND type
                console.log(`Encrypting message of type ${messageObject.type} for ${peerId}`);
                const encryptedPayload = await crypto.encryptMessage(peerId, JSON.stringify(messageObject));
                // Wrap encrypted data with a specific type
                dataToSend = JSON.stringify({
                    type: 'encrypted',
                    payload: encryptedPayload // Contains iv and ciphertext
                });
                console.log(`Sending encrypted message wrapper to ${peerId}`);
            } else {
                 // No shared key yet OR type should be plaintext
                 console.log(`Sending message type ${messageObject.type} to ${peerId} in plaintext.`);
                 dataToSend = JSON.stringify(messageObject);
            }
            // --- END ENCRYPTION ---

            // Check buffer before sending
            const BUFFER_THRESHOLD = 1024 * 1024; // 1MB, consistent with file transfer
            while (dc.bufferedAmount > BUFFER_THRESHOLD) {
                console.log(`[P2P Msg Send] DataChannel buffer full (${dc.bufferedAmount} > ${BUFFER_THRESHOLD}), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 50));
                // Re-check channel state after waiting
                if (dc.readyState !== 'open') {
                    throw new Error("Data channel closed while waiting for buffer to clear.");
                }
            }

            dc.send(dataToSend);
            // console.log(`Sent P2P message (or wrapper) of type ${messageObject.type} to ${peerId}`); // Log might be too verbose now
            return true;
        } catch (e) {
            console.error(`Error sending P2P message of type ${messageObject.type} to ${peerId}:`, e);
            ui.addSystemMessage(`向 ${state.contacts[peerId]?.name || peerId} 发送消息失败 (类型: ${messageObject.type})。错误: ${e.message}`, peerId, true);
            return false;
        }
    } else {
        console.warn(`Cannot send P2P message: Data channel for ${peerId} not open. State: ${dc?.readyState}`);
        ui.addSystemMessage(`无法向 ${state.contacts[peerId]?.name || peerId} 发送消息：连接未建立或已断开。`, peerId, true);
        return false;
    }
}

// Modified sendChatMessage to use helper (becomes async due to sendP2PMessage)
export async function sendChatMessage(text) { // Made async
    const activePeerId = state.getActiveChatPeerId();
    if (!activePeerId) {
        console.warn("sendChatMessage: No active chat selected.");
        ui.addSystemMessage("请先选择一个聊天对象。", null, true);
        return;
    }

    const message = {
        id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: 'text',
        senderId: state.localUserId,
        peerId: activePeerId,
        payload: { text: text },
        timestamp: Date.now()
    };

    if (await sendP2PMessage(activePeerId, message)) {
         storage.addMessage(message);
         ui.displayMessage(activePeerId, message);
         ui.clearChatInput();
    }
}

// Modified sendTypingIndicator to use helper (becomes async)
export async function sendTypingIndicator(isTyping) { // Made async
    const activePeerId = state.getActiveChatPeerId();
    if (!activePeerId) return;

    const indicatorMsg = {
        type: 'typing',
        payload: { isTyping: isTyping }
    };
    await sendP2PMessage(activePeerId, indicatorMsg);
}

// --- NEW: Functions to send friend request responses via P2P (becomes async) ---
export async function sendFriendAccept(peerId) { // Made async
    const acceptMessage = {
        type: 'friend_accept',
        payload: {
            acceptorId: state.localUserId,
            acceptorName: state.contacts[state.localUserId]?.name || state.localUserId,
            timestamp: Date.now()
        }
    };
    return await sendP2PMessage(peerId, acceptMessage);
}

export async function sendFriendDecline(peerId) { // Made async
    const declineMessage = {
        type: 'friend_decline',
        payload: {
            declinerId: state.localUserId,
            timestamp: Date.now()
        }
    };
    return await sendP2PMessage(peerId, declineMessage);
}

// --- NEW: Function to send friend request cancellation via P2P (async) ---
export async function sendFriendCancel(peerId) { // Made async
    const cancelMessage = {
        type: 'friend_cancel',
        payload: {
            cancellerId: state.localUserId, // Include canceller ID
            timestamp: Date.now()
        }
    };
    console.log(`Sending friend_cancel to ${peerId}`);
    // Send plaintext
    return await sendP2PMessage(peerId, cancelMessage);
}

// --- NEW: Function to send file acknowledgement ---
export async function sendFileAck(peerId, transferId) { // Made async
    if (!peerId || !transferId) {
        console.warn("sendFileAck called with missing peerId or transferId");
        return false;
    }

    const ackMessage = {
        type: 'file_ack',
        payload: { transferId: transferId }
    };

    console.log(`Sending file ACK for ${transferId} to ${peerId}`);
    return await sendP2PMessage(peerId, ackMessage);
}

export async function loadAndDisplayHistory(peerId) {
    if (!peerId) {
        console.warn("loadAndDisplayHistory called without peerId");
        return;
    }
    console.log(`Loading history for peer: ${peerId}`);
    ui.clearMessageList();

    try {
        const history = await storage.getMessages(peerId);
        console.log(`Loaded ${history.length} messages for ${peerId}`);
        history.forEach(msg => {
             ui.displayMessage(peerId, msg);
        });
        ui.scrollToBottom();
    } catch (e) {
        console.error(`Error loading history for ${peerId}:`, e);
        ui.addSystemMessage(`加载 ${state.contacts[peerId]?.name || peerId} 的聊天记录失败。`, peerId, true);
    }
}

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

// --- NEW: Function to send feedback when receiving message from non-friend ---
async function sendNotFriendError(peerId) {
    const errorMessage = {
        type: 'not_friend_error',
        payload: {
            senderId: state.localUserId // Indicate who is sending the error
        }
    };
    console.log(`Sending not_friend_error feedback to ${peerId}`);
    // This error message should probably be sent plaintext
    await sendP2PMessage(peerId, errorMessage, true); // Assuming sendP2PMessage can take a flag to force plaintext
}
// --- END NEW ---

// --- NEW: Function to send local profile info --- //
function sendProfileInfo(peerId) {
    const dataChannel = state.getDataChannel(peerId);
    if (dataChannel && dataChannel.readyState === 'open') {
        console.log(`[Profile] Sending profile info to ${peerId}`);
        const profileMessage = {
            type: 'profile_info',
            payload: {
                nickname: state.localUserNickname,
                avatar: state.localUserAvatar
            }
        };
        try {
            dataChannel.send(JSON.stringify(profileMessage));
            console.log(`[Profile] Sent profile info to ${peerId}:`, profileMessage.payload);
        } catch (error) {
            console.error(`[Profile] Failed to send profile info to ${peerId}:`, error);
        }
    } else {
        console.warn(`[Profile] Cannot send profile info to ${peerId}: Data channel not open or available.`);
    }
}
// --- END NEW --- //

// --- NEW: Handler for when peer indicates we are removed --- //
function handlePeerRemovedUs(peerId) {
    if (!state.contacts[peerId]) {
        console.warn(`handlePeerRemovedUs called for non-contact: ${peerId}. Ignoring.`);
        return;
    }

    const currentStatus = state.contacts[peerId].friendStatus;
    if (currentStatus === 'removed_by_peer') {
        console.log(`Already marked as removed_by_peer for ${peerId}. Ignoring redundant notification.`);
        return; // Avoid redundant actions
    }

    const peerName = state.contacts[peerId].name || peerId;
    console.log(`Handling 'removed_by_peer' status for ${peerName} (${peerId})`);

    // 1. Update state
    state.setContactFriendStatus(peerId, 'removed_by_peer');

    // 2. Disconnect connection
    resetPeerConnection(peerId, "Received not_friend_error");

    // 3. Update UI (re-render the list for now)
    // TODO: Optimize UI update to only change the appearance of this contact?
    ui.renderContactList();

    // 4. Show system message
    ui.addSystemMessage(`${peerName} 已将您从好友列表中移除。您可以重新发送好友请求。`, null);
}
// --- END NEW --- //