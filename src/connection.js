// connection.js
import * as state from './state.js';
import { SIGNALING_SERVER_URL, PEER_CONNECTION_CONFIG } from './constants.js';
import * as ui from '../ui/index.js';
import * as crypto from './crypto.js';
import * as fileTransfer from './fileTransfer.js';
// import * as dom from './dom.js'; // Needed for updating UI elements based on WS state
import * as storage from './storage.js'; // Import storage module
import { resetAllConnections, getActiveChatPeerId } from './state.js'; // Import resetAllConnections, getActiveChatPeerId
// import { formatBytes } from './utils.js'; // Import formatBytes from utils
import { deriveSharedKey } from './crypto.js';

// --- NEW: Store pending ICE candidates ---
const pendingCandidates = new Map(); // Map<peerId, RTCIceCandidate[]>
// --- END NEW ---

// --- WebSocket Logic ---

function sendSignalingMessage(payload) {
    const ws = state.getWs(); // USE GETTER
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            const messageString = JSON.stringify(payload);
            ws.send(messageString); // Use ws from getter
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

    const contacts = state.getContacts(); // USE GETTER

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
            ui.addSystemMessage(`收到来自 ${contacts[peerId]?.name || peerId} 的连接请求...`, peerId); // Use contacts from getter
            handleOffer(peerId, msg.payload.sdp);
            break;

        case 'answer':
            const isExpecting = state.isExpectingAnswerFrom(peerId); // Uses internal state via helper
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
            const isActiveOrPending = state.isPeerConnectionActiveOrPending(peerId); // Uses internal state via helper
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
            ui.addSystemMessage(`信令服务器错误 (${contacts[targetPeerIdOnError]?.name || targetPeerIdOnError}): ${errorMsg}`, targetPeerIdOnError, true); // Use contacts from getter

            if (errorMsg.includes("not found") || errorMsg.includes("offline")) {
                 ui.addSystemMessage(`目标用户 ${contacts[targetPeerIdOnError]?.name || targetPeerIdOnError} 未找到或离线。`, targetPeerIdOnError, true); // Use contacts from getter
                 resetPeerConnection(targetPeerIdOnError);
            } else {
                 resetPeerConnection(targetPeerIdOnError);
            }
            break;

        case 'busy':
             const busyPeerId = peerId;
             console.log(`Peer ${busyPeerId} is busy.`);
             ui.addSystemMessage(`${contacts[busyPeerId]?.name || busyPeerId} 当前正忙，请稍后再试。`, busyPeerId, true); // Use contacts from getter
             resetPeerConnection(busyPeerId);
             break;

        case 'user_disconnected':
             const disconnectedUserId = msg.payload?.userId;
             if (disconnectedUserId) {
                 console.log(`Signaling server indicated ${disconnectedUserId} disconnected.`);
                 if (state.isPeerConnectionActiveOrPending(disconnectedUserId)) { // Uses internal state via helper
                     ui.addSystemMessage(`与 ${contacts[disconnectedUserId]?.name || disconnectedUserId} 的连接已断开。`, disconnectedUserId); // Use contacts from getter
                     resetPeerConnection(disconnectedUserId);
                 }
                 // Status updates handled by resetPeerConnection
             }
            break;

        default:
            console.log("Received unhandled signaling message type:", msg.type);
    }
}

// --- NEW: Handle WebSocket disconnection logic ---
function handleWebSocketDisconnection(reason) {
    console.log(`WebSocket disconnected. Reason: ${reason}. Resetting all connections.`);
    const currentWs = state.getWs(); // USE GETTER
    // Display message only if not already disconnected
    if (currentWs !== null) { // Check if ws was previously set
        ui.addSystemMessage(`与信令服务器的连接已断开 (${reason})。`, null, true);
    }
    state.setWs(null); // USE SETTER
    state.resetAllConnections(); // Reset state first
    // Update UI for all contacts AFTER state is reset
    Object.keys(state.getContacts()).forEach(peerId => { // USE GETTER
         ui.updateContactStatusUI(peerId, false); // Explicitly set UI to offline
    });
    ui.updateChatInputVisibility();
}
// --- END NEW ---

export function connectWebSocket() {
    const ws = state.getWs(); // USE GETTER
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket is already open or connecting.");
        return;
    }
    console.log(`Attempting to connect to signaling server: ${SIGNALING_SERVER_URL}`);

    const newWs = new WebSocket(SIGNALING_SERVER_URL);

    newWs.onopen = () => {
        console.log("WebSocket connection established.");
        state.setWs(newWs); // USE SETTER
        const localUserId = state.localUserId; // Constant

        const registerMsg = { type: "register", payload: { userId: localUserId } };
        sendSignalingMessage(registerMsg);
        console.log(`Sent register message for user: ${localUserId}`);

        ui.addSystemMessage(`已连接到信令服务器，您的 ID 是: ${localUserId}`);
    };

    newWs.onmessage = handleWebSocketMessage;

    newWs.onerror = (error) => {
        console.error("WebSocket error:", error);
        handleWebSocketDisconnection("错误");
    };

    newWs.onclose = (event) => {
        console.log(`WebSocket connection closed: Code=${event.code}, Reason='${event.reason}'`);
        const reason = event.wasClean ? "正常关闭" : "意外断开";
        handleWebSocketDisconnection(reason);
    };
}

// --- WebRTC Logic ---

function createPeerConnection(peerId) {
    console.log(`Attempting to create PeerConnection for peer: ${peerId}`);
    const contacts = state.getContacts(); // USE GETTER

    console.log("Creating new PeerConnection with config:", PEER_CONNECTION_CONFIG);
    try {
        const newPc = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
        state.setPeerConnection(peerId, newPc); // Uses setter (Map)
        setupPeerConnectionEvents(peerId, newPc);
        return newPc;
    } catch (e) {
        console.error(`Failed to create PeerConnection for ${peerId}:`, e);
        ui.addSystemMessage(`创建与 ${contacts[peerId]?.name || peerId} 的 PeerConnection 失败。`, peerId, true);
        console.log(`[RESET CALL] Triggered by: createPeerConnection catch block for ${peerId}`);
        resetPeerConnection(peerId);
        // state.updateContactStatus(peerId, false); // resetPeerConnection handles this
        // ui.updateContactStatusUI(peerId, false); // resetPeerConnection handles this
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
        const contacts = state.getContacts(); // Use getter
        let message = `与 ${contacts[peerId]?.name || peerId} 的连接`; // Use contacts from getter
        let isError = false;

        if (newState === 'failed') {
            message += ` 失败 (${stateType})。`;
            isError = true;
        } else if (newState === 'disconnected') {
            message += ` 中断 (${stateType})。可能尝试重连...`;
        } else if (newState === 'closed') {
            message += ` 已关闭 (${stateType})。`;
        }

        ui.addSystemMessage(message, peerId, isError);
        console.log(`[RESET CALL] Triggered by: ${stateType} state '${newState}' for ${peerId}`);
        resetPeerConnection(peerId, `${stateType} state ${newState}`);
    }
    // --- END NEW ---

    pc.oniceconnectionstatechange = () => {
        if (!pc) return;
        const currentState = pc.iceConnectionState;
        console.log(`ICE connection state for ${peerId} changed to: ${currentState}`);
        state.updateIceConnectionState(peerId, currentState); // Calls internal updateConnectionState

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
                break;
        }
    };

    pc.onconnectionstatechange = () => {
        if (!pc) return;
        const overallState = pc.connectionState;
         console.log(`Overall connection state for ${peerId} changed to: ${overallState}`);
         state.updateOverallConnectionState(peerId, overallState); // Calls internal updateConnectionState

        switch (overallState) {
            case 'new':
            case 'connecting':
                break;
            case 'connected':
                 console.log(`Overall connection established for ${peerId}.`);
                 const dc = state.getDataChannel(peerId);
                 if (dc?.readyState === 'open') {
                    state.updateContactStatus(peerId, true); // Updates internal contacts
                    ui.updateContactStatusUI(peerId, true);
                 } else {
                    state.updateContactStatus(peerId, 'connecting'); // Updates internal contacts
                    ui.updateContactStatusUI(peerId, 'connecting');
                 }
                break;
            case 'failed':
            case 'disconnected':
            case 'closed':
                 handlePeerConnectionFailure(peerId, 'Overall', overallState);
                break;
        }
    };

    pc.ondatachannel = (event) => {
        console.log(`Data channel received from ${peerId}: ${event.channel.label}`);
        const dc = event.channel;
         state.setDataChannel(peerId, dc); // Uses setter (Map)

        setupDataChannelEvents(peerId, dc);

        if (pc.connectionState === 'connected') {
             state.updateContactStatus(peerId, true); // Updates internal contacts
             ui.updateContactStatusUI(peerId, true);
        }
    };

     pc.onsignalingstatechange = () => {
         if (!pc) return;
         console.log(`Signaling state for ${peerId} changed to: ${pc.signalingState}`);
         state.updateSignalingState(peerId, pc.signalingState); // Calls internal updateConnectionState
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
        state.updateDataChannelState(peerId, 'open'); // Calls internal updates

        const pc = state.getPeerConnection(peerId);
        if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'completed')) {
           state.updateContactStatus(peerId, true); // Updates internal contacts
           ui.updateContactStatusUI(peerId, true);
           if (state.isActiveChat(peerId)) { // Uses helper -> internal _activeChatPeerId
                 ui.updateChatInputVisibility();
           }
        } else {
             console.warn(`Data channel for ${peerId} opened, but overall connection state is ${pc?.connectionState}. Waiting.`);
             state.updateContactStatus(peerId, 'connecting'); // Updates internal contacts
             ui.updateContactStatusUI(peerId, 'connecting');
        }

        // --- NEW: Send Public Key on Data Channel Open ---
        const localKeyPair = state.getLocalKeyPair(); // USE GETTER
        if (localKeyPair && localKeyPair.publicKey) {
            try {
                const publicKeyJwk = await crypto.exportPublicKey(localKeyPair.publicKey);
                if (publicKeyJwk) {
                    const keyMessage = {
                        type: 'publicKey',
                        payload: { jwk: publicKeyJwk }
                    };
                    await sendP2PMessage(peerId, keyMessage);
                    console.log(`Sent public key to ${peerId}`);
                } else {
                     console.error(`Failed to export local public key for sending to ${peerId}.`);
                     const contacts = state.getContacts(); // USE GETTER
                     ui.addSystemMessage(`无法导出本地公钥以发送给 ${contacts[peerId]?.name || peerId}。`, peerId, true);
                }
            } catch (error) {
                console.error(`Error exporting or sending public key to ${peerId}:`, error);
                 const contacts = state.getContacts(); // USE GETTER
                 ui.addSystemMessage(`发送公钥给 ${contacts[peerId]?.name || peerId} 时出错。`, peerId, true);
            }
        } else {
             console.warn(`Cannot send public key to ${peerId}: Local key pair not available.`);
             ui.addSystemMessage(`无法发送公钥：本地密钥对不可用。`, peerId, true);
        }
        // --- END NEW --- 

        // --- Send Profile Info on Open --- // 
        console.log(`[Connection dc.onopen] Data channel open for ${peerId}. Attempting to send profile info.`);
        sendProfileInfo(peerId);
        // --- END --- //
    };

    dc.onclose = () => {
        console.log(`[General Handler] Data channel closed for peer ${peerId}`);
         state.updateDataChannelState(peerId, 'closed'); // Calls internal updates
        console.log(`[RESET CALL] Triggered by: dc.onclose for ${peerId}`);
        resetPeerConnection(peerId);
         // state.updateContactStatus(peerId, false); // resetPeerConnection handles status
         // ui.updateContactStatusUI(peerId, false);
          if (state.isActiveChat(peerId)) { // Uses helper -> internal _activeChatPeerId
                 ui.updateChatInputVisibility();
           }
    };

    dc.onerror = (error) => {
        console.error(`[General Handler] Data channel error for peer ${peerId}:`, error);
        const contacts = state.getContacts(); // Use getter
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
            ui.addSystemMessage(`与 ${contacts[peerId]?.name || peerId} 的数据通道发生错误，正在重置连接。`, peerId, true);
            console.log(`[RESET CALL] Triggered by: dc.onerror (non-abort error) for ${peerId}`);
            resetPeerConnection(peerId);
        }
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
            const contacts = state.getContacts(); // Define contacts ONCE here
            try {
                let parsedMessage;
                let messageType = 'unknown';
                let payload = {};
                let originalSenderId = peerId;
                // const localUserId = state.localUserId; // Constant - Already defined or not needed here?

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
                                    ui.addSystemMessage(`无法解密来自 ${contacts[peerId]?.name || peerId} 的消息。`, peerId, true);
                                    // Should we return or try to process as plaintext? Return seems safer.
                                    return;
                                }
                            } else {
                                 console.warn(`Received encrypted message from ${peerId}, but no shared key available. Ignoring.`);
                                 ui.addSystemMessage(`收到来自 ${contacts[peerId]?.name || peerId} 的加密消息，但无法解密（无密钥）。`, peerId, true);
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
                         if (!contacts[originalSenderId]) { // Use contacts defined above
                             console.warn(`Received text message from non-contact ${originalSenderId}. Ignoring and sending error.`);
                             sendNotFriendError(originalSenderId);
                             return;
                         }
                        const messageToStore = {
                            id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                            senderId: originalSenderId,
                            peerId: originalSenderId,
                            type: 'text',
                            payload: { text: payload.text },
                            timestamp: payload.timestamp || Date.now()
                        };
                        await storage.addMessage(messageToStore);
                        console.log(`Stored text message from ${originalSenderId}:`, messageToStore);
                        if (state.isActiveChat(originalSenderId)) { // Uses helper -> internal _activeChatPeerId
                            ui.displayMessage(originalSenderId, messageToStore);
                        } else {
                            state.setHasUnreadMessages(originalSenderId, true); // Use setter
                            ui.showUnreadIndicator(originalSenderId, true);
                        }
                        break;

                    case 'fileMeta':
                         if (!contacts[originalSenderId]) { // Use contacts from getter
                             console.warn(`Received fileMeta from non-contact ${originalSenderId}. Ignoring and sending error.`);
                             sendNotFriendError(originalSenderId);
                             return;
                         }
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
                        if (state.isActiveChat(originalSenderId)) { // Uses helper -> internal _activeChatPeerId
                            ui.displayMessage(originalSenderId, messageForUi);
                        } else {
                            state.setHasUnreadMessages(originalSenderId, true); // Use setter
                            ui.showUnreadIndicator(originalSenderId, true);
                        }
                        fileTransfer.handleIncomingFileMeta(originalSenderId, fileInfo);
                        break;

                    case 'typing':
                        console.log(`Received typing indicator from ${originalSenderId}:`, payload.isTyping);
                        if (state.isActiveChat(originalSenderId)) { // Update UI only if chat is active
                             ui.showTypingIndicator(originalSenderId, payload.isTyping);
                        }
                        state.setPeerIsTyping(originalSenderId, payload.isTyping); // Update state regardless
                        break;

                    case 'publicKey':
                        if (payload.jwk) {
                            console.log(`Received public key from ${originalSenderId}`);
                            await crypto.handlePublicKey(originalSenderId, payload.jwk); // crypto module might need update
                        } else {
                            console.warn(`Received invalid publicKey message from ${originalSenderId}: Missing jwk in payload.`);
                        }
                        break;

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
                        state.addPendingIncomingRequest(requestData); // Uses internal state
                        // --- NEW: Use addOrUpdateContact instead of addContact --- //
                        state.addOrUpdateContact({ // Uses internal state
                            id: originalSenderId,
                            name: requestData.name,
                            friendStatus: 'pending_incoming'
                        });
                        // --- END NEW ---

                        // Notify UI
                        ui.renderContactList();
                        ui.addSystemMessage(`${requestData.name} 请求添加您为好友。`, null);
                        break;

                    case 'friend_accept':
                        console.log(`[Friend Request] Received friend_accept from ${peerId}:`, payload);
                        // Validate payload
                        if (!payload.acceptorId || payload.acceptorId !== peerId) {
                            console.warn(`[Friend Request] Invalid acceptorId in accept message from ${peerId}. Ignoring.`);
                            return;
                        }
                        // Check if we actually sent a request
                        if (!state.hasPendingOutgoingRequest(peerId)) {
                            console.warn(`[Friend Request] Received unexpected accept from ${peerId}. Ignoring.`);
                            return;
                        }
                        // Process acceptance
                        state.removePendingOutgoingRequest(peerId); // Uses internal state
                        const acceptorName = payload.acceptorName || peerId;
                        
                        // --- NEW: Explicitly set friend status to confirmed ---
                        state.setContactFriendStatus(peerId, 'confirmed');
                        // Optionally update name if different (addContact logic moved here if needed)
                        if (contacts[peerId] && contacts[peerId].name !== acceptorName) { // Use contacts defined above
                            contacts[peerId].name = acceptorName;
                            state.saveContacts(); // Make sure to save if name is updated
                            console.log(`[Friend Accept] Updated name for ${peerId} to ${acceptorName}`);
                        }
                        // --- END NEW ---

                        // Update UI
                        ui.renderContactList(); // Re-render to show as full contact
                        ui.addSystemMessage(`${acceptorName} 已接受您的好友请求。`, null);

                        // --- MODIFIED: Explicitly update UI status and switch chat ---
                        ui.updateContactStatusUI(peerId, 'connecting'); // Assume connecting first
                        // Don't switch chat automatically here, let user decide
                        // await ui.switchToChat(peerId); // Let user click if they want to chat now

                        // Attempt connection after receiving acceptance
                        connectToPeer(peerId) // Use peerId
                            .then(dc => {
                                // Connection successful (or already existed), ensure UI is fully online
                                console.log(`[Friend Accept] connectToPeer successful for ${peerId}. Ensuring UI is online.`); // Use peerId
                                ui.updateContactStatusUI(peerId, true); // Use peerId
                                if (state.isActiveChat(peerId)) { // Update input only if active // Use peerId
                                    ui.updateChatInputVisibility();
                                }
                            })
                            .catch(err => {
                                console.error(`[Friend Accept] connectToPeer failed for ${peerId} after acceptance:`, err); // Use peerId
                                // Show error and potentially mark offline
                                ui.addSystemMessage(`尝试自动连接到 ${acceptorName} 失败: ${err.message}`, peerId, true); // Use peerId
                                ui.updateContactStatusUI(peerId, false); // Use peerId
                                if (state.isActiveChat(peerId)) { // Update input only if active // Use peerId
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
                        // --- Get name BEFORE removing contact --- //
                        const contactsBeforeRemoval = state.getContacts();
                        const declinerName = contactsBeforeRemoval[originalSenderId]?.name || originalSenderId;
                        // -------------------------------------- //
                        // --- Remove the contact from the main contacts list --- //
                        state.removeContact(originalSenderId);
                        // ----------------------------------------------------- //

                        // Update UI
                        ui.renderContactList(); // Re-render to remove pending state
                        // --- Use the stored name for the system message --- //
                        ui.addSystemMessage(`${declinerName} 已拒绝您的好友请求。`, null);
                        // -------------------------------------------------- //

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
                console.error(`Error processing message from ${peerId}:`, e);
                // Note: contacts is already defined in the outer scope here
                 ui.addSystemMessage(`处理来自 ${contacts[peerId]?.name || peerId} 的消息时出错。`, peerId, true);
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

    const makingOffer = state.isMakingOffer(peerId); // Uses internal state via helper
    if (makingOffer || pc.signalingState !== "stable") {
        console.log(`Ignoring offer from ${peerId} due to signaling state: ${pc.signalingState} or making offer flag.`);
        return;
    }

    try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }));
        console.log(`Remote description (offer) set for peer ${peerId}`);
        await processQueuedCandidates(peerId, pc);

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
        state.updateConnectionState(peerId, 'connecting'); // Updates internal state
        ui.updateContactStatusUI(peerId, 'connecting');

    } catch (e) {
        console.error(`Error handling offer from ${peerId}:`, e);
        resetPeerConnection(peerId);
    }
}

async function handleAnswer(peerId, answerSdp) {
    console.log(`Handling answer for peer: ${peerId}`);
    const pc = state.getPeerConnection(peerId); // Uses getter (Map)

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
        await processQueuedCandidates(peerId, pc);
    } catch (e) {
        console.error(`Error handling answer from ${peerId}:`, e);
        resetPeerConnection(peerId);
    }
}

async function handleCandidate(peerId, candidate) {
     console.log(`Handling ICE candidate for peer: ${peerId}`);
    const pc = state.getPeerConnection(peerId); // Uses getter (Map)

    if (!pc) {
        console.error(`No PeerConnection found for peer ${peerId} when handling candidate.`);
        return;
    }

    if (!candidate) {
        console.log(`Received null candidate for ${peerId}, signaling end-of-candidates.`);
        // End-of-candidates doesn't need queuing
        return;
    }

    const iceCandidate = new RTCIceCandidate(candidate);

    try {
        if (!pc.remoteDescription) {
             console.warn(`[ICE Queueing] PeerConnection for ${peerId} has no remote description yet. Queuing candidate.`);
             // Queue the candidate
             if (!pendingCandidates.has(peerId)) {
                 pendingCandidates.set(peerId, []);
             }
             pendingCandidates.get(peerId).push(iceCandidate);
             console.log(`[ICE Queueing] Queued candidate for ${peerId}. Queue size: ${pendingCandidates.get(peerId).length}`);
             return; // Don't try to add it yet
        }
        // Remote description exists, try adding candidate directly
        await pc.addIceCandidate(iceCandidate);
         console.log(`Added ICE candidate for peer ${peerId}`);
    } catch (e) {
        // Ignore errors adding candidates if the connection is already closed
        // This often happens during simultaneous connection closures.
        if (pc.signalingState !== 'closed') {
            console.error(`Error adding ICE candidate for ${peerId}:`, e);
            // Optionally reset connection on candidate error?
            // resetPeerConnection(peerId, "ICE Candidate Add Error");
        }
    }
}

// --- NEW: Function to process queued ICE candidates ---
async function processQueuedCandidates(peerId, pc) {
    const queue = pendingCandidates.get(peerId);
    if (queue && queue.length > 0) {
        console.log(`[ICE Queueing] Processing ${queue.length} queued candidates for ${peerId}`);
        // Process candidates sequentially
        for (const candidate of queue) {
            try {
                if (pc.remoteDescription) { // Double check remote description before adding
                     await pc.addIceCandidate(candidate);
                     console.log(`[ICE Queueing] Successfully added queued candidate for ${peerId}`);
                } else {
                    console.warn(`[ICE Queueing] Cannot add queued candidate for ${peerId}, remoteDescription is still null.`);
                    // Candidate remains in queue? Or should we clear?
                    // Let's log and continue, maybe remote desc will be set later by another path?
                    // This case shouldn't ideally happen if called right after setRemoteDescription succeeds.
                }
            } catch (e) {
                if (pc.signalingState !== 'closed') {
                    console.error(`[ICE Queueing] Error adding queued ICE candidate for ${peerId}:`, e);
                }
            }
        }
        // Clear the queue after processing
        pendingCandidates.delete(peerId);
        console.log(`[ICE Queueing] Cleared candidate queue for ${peerId}`);
    } else {
         console.log(`[ICE Queueing] No queued candidates to process for ${peerId}`);
    }
}
// --- END NEW ---

// --- Public Connection Functions ---

// --- REVISED connectToPeer function --- returns Promise<RTCDataChannel>
export function connectToPeer(targetPeerId) {
    return new Promise(async (resolve, reject) => {
        if (!targetPeerId) {
            return reject(new Error("connectToPeer called without targetPeerId"));
        }
        const currentState = state.getConnectionState(targetPeerId); // Uses getter (Map)
        if (currentState === 'connected') {
            const existingDc = state.getDataChannel(targetPeerId); // Uses getter (Map)
            if (existingDc && existingDc.readyState === 'open') {
                console.log(`connectToPeer: Already connected with open DC to ${targetPeerId}. Resolving immediately.`);
                return resolve(existingDc);
            } else {
                 console.log(`connectToPeer: State is connected but DC not open for ${targetPeerId}. Resetting and re-connecting.`);
            }
        } else if (currentState === 'connecting') {
             console.log(`connectToPeer: Already attempting to connect to ${targetPeerId}. Rejecting new attempt.`);
            return reject(new Error(`Already connecting to ${targetPeerId}.`));
        }
        console.log(`connectToPeer: Attempting connection to peer: ${targetPeerId}`);
        const contacts = state.getContacts(); // USE GETTER

        resetPeerConnection(targetPeerId, "Connect Attempt Start"); // Calls functions using internal state

        let timeoutId = null;
        let isCleanupCalled = false;

        const cleanup = (reason, error = null) => {
            if (isCleanupCalled) return;
            isCleanupCalled = true;
            console.log(`[connectToPeer Cleanup] Reason: ${reason} for ${targetPeerId}`);
            clearTimeout(timeoutId);
            if (error) {
                reject(error);
            }
        };

        timeoutId = setTimeout(() => {
            const timeoutError = new Error(`Connection to ${targetPeerId} timed out.`);
            console.log(`[connectToPeer Timeout] ${timeoutError.message}`);
            ui.addSystemMessage(`连接 ${contacts[targetPeerId]?.name || targetPeerId} 超时。`, targetPeerId, true); // Use contacts from getter
            resetPeerConnection(targetPeerId, "Connection Timeout");
            cleanup("Timeout", timeoutError);
        }, 30000); // 30 seconds

        ui.addSystemMessage(`正在尝试连接到 ${contacts[targetPeerId]?.name || targetPeerId}...`, targetPeerId); // Use contacts from getter
        state.updateContactStatus(targetPeerId, 'connecting'); // Updates internal contacts
        state.updateConnectionState(targetPeerId, 'connecting'); // Updates internal state
        state.setIsMakingOffer(targetPeerId, true); // Uses setter (Map)

        const pc = createPeerConnection(targetPeerId);
        if (!pc) {
            const creationError = new Error(`Failed to create PeerConnection for ${targetPeerId}`);
            cleanup("PC Creation Failed", creationError);
            return;
        }

        const handleIceConnectionFailure = () => {
            if (pc.iceConnectionState === 'failed') {
                const iceError = new Error(`ICE connection failed for ${targetPeerId}.`);
                console.log(`[connectToPeer ICE Fail] ${iceError.message}`);
                ui.addSystemMessage(`与 ${contacts[targetPeerId]?.name || targetPeerId} 的连接失败 (ICE)。`, targetPeerId, true); // Use contacts from getter
                resetPeerConnection(targetPeerId, "ICE Failed");
                cleanup("ICE Failed", iceError);
            } else if ((pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'disconnected') && state.getDataChannel(targetPeerId)?.readyState !== 'open') { // Uses getter (Map)
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
                 ui.addSystemMessage(`与 ${contacts[targetPeerId]?.name || targetPeerId} 的连接失败。`, targetPeerId, true); // Use contacts from getter
                 resetPeerConnection(targetPeerId, "Connection Failed");
                 cleanup("Connection Failed", connError);
             } else if ((pc.connectionState === 'closed' || pc.connectionState === 'disconnected') && state.getDataChannel(targetPeerId)?.readyState !== 'open') { // Uses getter (Map)
                 const connCloseError = new Error(`Overall connection ${pc.connectionState} for ${targetPeerId} before data channel open.`);
                 console.log(`[connectToPeer Conn Close/Disconnect] ${connCloseError.message}`);
                 resetPeerConnection(targetPeerId, "Connection Closed/Disconnected Early");
                 cleanup("Connection Closed/Disconnected Early", connCloseError);
             }
        };
        pc.addEventListener('iceconnectionstatechange', handleIceConnectionFailure);
        pc.addEventListener('connectionstatechange', handleConnectionFailure);

        try {
            console.log(`Creating data channel for ${targetPeerId}`);
            const dc = pc.createDataChannel('chat', { negotiated: false });
            state.setDataChannel(targetPeerId, dc); // Uses setter (Map)
            setupDataChannelEvents(targetPeerId, dc); // Uses state getters internally

            const handleDcOpen = () => {
                console.log(`[connectToPeer DC Open] Data channel opened for ${targetPeerId}. Resolving promise.`);
                cleanup("DC Open");
                resolve(dc);
            };
            const handleDcClose = () => {
                 const closeError = new Error(`Data channel closed for ${targetPeerId} before promise resolved.`);
                 console.log(`[connectToPeer DC Close] ${closeError.message}`);
                 cleanup("DC Closed Early", closeError);
            };
            const handleDcError = (errorEvent) => {
                 const dcError = new Error(`Data channel error for ${targetPeerId}: ${errorEvent?.error?.message || 'Unknown error'}`);
                 console.error(`[connectToPeer DC Error] ${dcError.message}`, errorEvent);
                 cleanup("DC Error", dcError);
            };
            dc.addEventListener('open', handleDcOpen);
            dc.addEventListener('close', handleDcClose);
            dc.addEventListener('error', handleDcError);

            console.log(`Creating offer for ${targetPeerId}`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log(`Local description (offer) set for ${targetPeerId}`);
            await processQueuedCandidates(targetPeerId, pc); // Process candidates after local desc

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
            ui.addSystemMessage(`无法发起与 ${contacts[targetPeerId]?.name || targetPeerId} 的连接。`, targetPeerId, true); // Use contacts from getter
            resetPeerConnection(targetPeerId, "Connect Initiate Error");
            cleanup("Connect Initiate Error", creationError);
        }
    });
}

export function disconnectFromPeer(peerId) {
    if (!peerId) {
         console.warn("disconnectFromPeer called without peerId");
         peerId = state.getActiveChatPeerId(); // USE GETTER
         if (!peerId) return;
    }
    console.log(`Disconnecting from peer: ${peerId}`);
     const pc = state.getPeerConnection(peerId); // Uses getter (Map)
     const contacts = state.getContacts(); // USE GETTER

    if (pc) {
        ui.addSystemMessage(`正在断开与 ${contacts[peerId]?.name || peerId} 的连接...`, peerId); // Use contacts from getter
        console.log(`[RESET CALL] Triggered by: disconnectFromPeer explicit call for ${peerId}`);
        resetPeerConnection(peerId);
    } else {
        console.log(`No active connection found for peer ${peerId} to disconnect.`);
        // Ensure state and UI are updated even if no PC was found
         state.updateContactStatus(peerId, false); // Updates internal contacts
         ui.updateContactStatusUI(peerId, false);
         state.updateConnectionState(peerId, 'disconnected'); // Updates internal state
    }
}

export function resetPeerConnection(peerId, reason = "Unknown") {
     if (!peerId) {
         console.warn("resetPeerConnection called without peerId. This might indicate a logic error.");
         return;
     }
    console.log(`[RESET] Resetting connection state for peer: ${peerId}. Reason: ${reason}`);

    state.resetPeerState(peerId); // Calls function operating on internal maps

    if (pendingCandidates.has(peerId)) {
        console.log(`[RESET] Clearing ${pendingCandidates.get(peerId).length} pending ICE candidates for ${peerId}`);
        pendingCandidates.delete(peerId);
    }

    // Update UI after state reset
    if (state.isActiveChat(peerId)) { // Uses helper -> internal _activeChatPeerId
        ui.updateChatInputVisibility();
    }
    // Ensure UI status is updated to reflect the reset state
    ui.updateContactStatusUI(peerId, false);

    console.log(`Finished resetting connection for ${peerId}`);
}

// --- MODIFIED: Send P2P message helper (Uses Getters) ---
async function sendP2PMessage(peerId, messageObject, forcePlaintext = false) {
    const dc = state.getDataChannel(peerId); // Uses getter (Map)
    const contacts = state.getContacts(); // USE GETTER
    if (dc && dc.readyState === 'open') {
        try {
            let dataToSend;
            const keys = state.getPeerKeys(peerId); // Uses getter (Map)
            const plaintextMessageTypes = ['publicKey', 'friend_request', 'friend_accept', 'friend_decline', 'friend_cancel', 'not_friend_error'];

            if (!forcePlaintext && keys && keys.sharedKey && !plaintextMessageTypes.includes(messageObject.type)) {
                console.log(`Encrypting message of type ${messageObject.type} for ${peerId}`);
                const encryptedPayload = await crypto.encryptMessage(peerId, JSON.stringify(messageObject)); // crypto needs update
                dataToSend = JSON.stringify({
                    type: 'encrypted',
                    payload: encryptedPayload
                });
                console.log(`Sending encrypted message wrapper to ${peerId}`);
            } else {
                 console.log(`Sending message type ${messageObject.type} to ${peerId} in plaintext.`);
                 dataToSend = JSON.stringify(messageObject);
            }

            const BUFFER_THRESHOLD = 1024 * 1024;
            while (dc.bufferedAmount > BUFFER_THRESHOLD) {
                console.log(`[P2P Msg Send] DataChannel buffer full (${dc.bufferedAmount} > ${BUFFER_THRESHOLD}), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 50));
                if (dc.readyState !== 'open') {
                    throw new Error("Data channel closed while waiting for buffer to clear.");
                }
            }

            dc.send(dataToSend);
            return true;
        } catch (e) {
            console.error(`Error sending P2P message of type ${messageObject.type} to ${peerId}:`, e);
            ui.addSystemMessage(`向 ${contacts[peerId]?.name || peerId} 发送消息失败 (类型: ${messageObject.type})。错误: ${e.message}`, peerId, true); // Use contacts from getter
            return false;
        }
    } else {
        console.warn(`Cannot send P2P message: Data channel for ${peerId} not open. State: ${dc?.readyState}`);
        ui.addSystemMessage(`无法向 ${contacts[peerId]?.name || peerId} 发送消息：连接未建立或已断开。`, peerId, true); // Use contacts from getter
        return false;
    }
}

export async function sendChatMessage(text) {
    const activePeerId = state.getActiveChatPeerId(); // USE GETTER
    if (!activePeerId) {
        console.warn("sendChatMessage: No active chat selected.");
        ui.addSystemMessage("请先选择一个聊天对象。", null, true);
        return;
    }
    const localUserId = state.localUserId; // Constant
    const message = {
        id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type: 'text',
        senderId: localUserId,
        peerId: activePeerId,
        payload: { text: text },
        timestamp: Date.now()
    };

    if (await sendP2PMessage(activePeerId, message)) {
         await storage.addMessage(message);
         ui.displayMessage(activePeerId, message);
         ui.clearChatInput();
    }
}

export async function sendTypingIndicator(isTyping) {
    const activePeerId = state.getActiveChatPeerId(); // USE GETTER
    if (!activePeerId) return;

    const indicatorMsg = {
        type: 'typing',
        payload: { isTyping: isTyping }
    };
    await sendP2PMessage(activePeerId, indicatorMsg);
}

// --- Friend Request Response Sending (Use Getters/Constants) ---
export async function sendFriendAccept(peerId) {
    const localUserId = state.localUserId; // Constant
    const localUserNickname = state.getLocalUserNickname(); // USE GETTER
    const acceptMessage = {
        type: 'friend_accept',
        payload: {
            acceptorId: localUserId,
            acceptorName: localUserNickname, // Use getter result
            timestamp: Date.now()
        }
    };
    return await sendP2PMessage(peerId, acceptMessage);
}

export async function sendFriendDecline(peerId) {
    const localUserId = state.localUserId; // Constant
    const declineMessage = {
        type: 'friend_decline',
        payload: {
            declinerId: localUserId,
            timestamp: Date.now()
        }
    };
    return await sendP2PMessage(peerId, declineMessage);
}

export async function sendFriendCancel(peerId) {
    const localUserId = state.localUserId; // Constant
    const cancelMessage = {
        type: 'friend_cancel',
        payload: {
            cancellerId: localUserId,
            timestamp: Date.now()
        }
    };
    console.log(`Sending friend_cancel to ${peerId}`);
    return await sendP2PMessage(peerId, cancelMessage);
}

// --- File Ack Sending (Uses state.localUserId) ---
export async function sendFileAck(peerId, transferId) {
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

// --- Load History (Uses state.getContacts) ---
export async function loadAndDisplayHistory(peerId) {
    if (!peerId) {
        console.warn("loadAndDisplayHistory called without peerId");
        return;
    }
    const contacts = state.getContacts(); // USE GETTER
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
        ui.addSystemMessage(`加载 ${contacts[peerId]?.name || peerId} 的聊天记录失败。`, peerId, true); // Use contacts from getter
    }
}

function handleVisibilityChange() {
    if (document.hidden) {
        const isTyping = state.getIsTyping(); // USE GETTER
        const typingTimeout = state.getTypingTimeout(); // USE GETTER
        if (isTyping && typingTimeout) {
            clearTimeout(typingTimeout);
            state.setTypingTimeout(null); // USE SETTER
             sendTypingIndicator(false);
             console.log("Window hidden, stopped typing indicator timer.");
        }
    }
}

document.addEventListener("visibilitychange", handleVisibilityChange, false);

// --- Send Not Friend Error (Uses state.localUserId) ---
async function sendNotFriendError(peerId) {
    const localUserId = state.localUserId; // Constant
    const errorMessage = {
        type: 'not_friend_error',
        payload: { senderId: localUserId }
    };
    console.log(`Sending not_friend_error feedback to ${peerId}`);
    await sendP2PMessage(peerId, errorMessage, true);
}

// --- Send Profile Info (Uses Getters) ---
function sendProfileInfo(peerId) {
    const dataChannel = state.getDataChannel(peerId); // Uses getter (Map)
    if (dataChannel && dataChannel.readyState === 'open') {
        console.log(`[Profile] Sending profile info to ${peerId}`);
        const localUserNickname = state.getLocalUserNickname(); // USE GETTER
        const localUserAvatar = state.getLocalUserAvatar(); // USE GETTER
        const profileMessage = {
            type: 'profile_info',
            payload: {
                nickname: localUserNickname,
                avatar: localUserAvatar
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

// --- Handle Peer Removed Us (Uses Getters) ---
function handlePeerRemovedUs(peerId) {
    const contacts = state.getContacts(); // USE GETTER
    if (!contacts[peerId]) {
        console.warn(`handlePeerRemovedUs called for non-contact: ${peerId}. Ignoring.`);
        return;
    }
    const currentStatus = contacts[peerId].friendStatus;
    if (currentStatus === 'removed_by_peer') {
        console.log(`Already marked as removed_by_peer for ${peerId}. Ignoring redundant notification.`);
        return;
    }

    const peerName = contacts[peerId].name || peerId;
    console.log(`Handling 'removed_by_peer' status for ${peerName} (${peerId})`);
    state.setContactFriendStatus(peerId, 'removed_by_peer'); // Updates internal contacts
    resetPeerConnection(peerId, "Received not_friend_error");
    ui.renderContactList();
    ui.addSystemMessage(`${peerName} 已将您从好友列表中移除。您可以重新发送好友请求。`, null);
}