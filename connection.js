// connection.js
import * as state from './state.js';
import { SIGNALING_SERVER_URL, PEER_CONNECTION_CONFIG } from './constants.js';
import * as ui from './ui.js';
import * as crypto from './crypto.js';
import * as fileTransfer from './fileTransfer.js';
import * as dom from './dom.js'; // Needed for updating UI elements based on WS state
import * as storage from './storage.js'; // Import storage module
import { resetAllConnections } from './state.js'; // Import resetAllConnections
import { formatBytes } from './utils.js'; // Import formatBytes from utils

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
        state.resetAllConnections();
        Object.keys(state.contacts).forEach(peerId => {
             state.updateContactStatus(peerId, false);
             ui.updateContactStatusUI(peerId, false);
        });
         ui.updateChatInputVisibility();
    };

    newWs.onclose = (event) => {
        console.log(`WebSocket connection closed: Code=${event.code}, Reason='${event.reason}'`);
        if (!event.wasClean && !state.isConnected) {
             ui.addSystemMessage("与信令服务器的连接意外断开。", true);
        } else if (!state.isConnected) {
        }

        state.setWs(null);
        state.resetAllConnections();
         Object.keys(state.contacts).forEach(peerId => {
             state.updateContactStatus(peerId, false);
             ui.updateContactStatusUI(peerId, false);
        });
        ui.updateChatInputVisibility();
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
                console.error(`ICE connection failed for ${peerId}.`);
                ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接失败 (ICE)。`, peerId, true);
                console.log(`[RESET CALL] Triggered by: oniceconnectionstatechange 'failed' for ${peerId}`);
                resetPeerConnection(peerId);
                 state.updateContactStatus(peerId, false);
                 ui.updateContactStatusUI(peerId, false);
                break;
            case 'disconnected':
                console.log(`ICE connection disconnected for ${peerId}. May reconnect...`);
                ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接中断 (ICE)。可能尝试重连...`, peerId);
                state.updateContactStatus(peerId, false);
                ui.updateContactStatusUI(peerId, false);
                break;
            case 'closed':
                console.log(`ICE connection closed for ${peerId}.`);
                if (state.getConnectionState(peerId) !== 'closed' && state.getConnectionState(peerId) !== 'failed') {
                    console.log(`[RESET CALL] Triggered by: oniceconnectionstatechange 'closed' for ${peerId}`);
                    resetPeerConnection(peerId);
                }
                 state.updateContactStatus(peerId, false);
                 ui.updateContactStatusUI(peerId, false);
                break;
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
                    clearConnectionTimeout(peerId);
                    state.updateContactStatus(peerId, true);
                    ui.updateContactStatusUI(peerId, true);
                 } else {
                    state.updateContactStatus(peerId, 'connecting');
                    ui.updateContactStatusUI(peerId, 'connecting');
                 }

                break;
            case 'failed':
                console.error(`Overall connection failed for ${peerId}.`);
                 ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接失败。`, peerId, true);
                console.log(`[RESET CALL] Triggered by: onconnectionstatechange 'failed' for ${peerId}`);
                resetPeerConnection(peerId);
                 state.updateContactStatus(peerId, false);
                 ui.updateContactStatusUI(peerId, false);
                break;
            case 'disconnected':
                 console.log(`Overall connection disconnected for ${peerId}.`);
                ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的连接中断。`, peerId);
                console.log(`[RESET CALL] Triggered by: onconnectionstatechange 'disconnected' for ${peerId}`);
                resetPeerConnection(peerId);
                 state.updateContactStatus(peerId, false);
                 ui.updateContactStatusUI(peerId, false);
                break;
            case 'closed':
                 console.log(`Overall connection closed for ${peerId}.`);
                if (state.getConnectionState(peerId) !== 'closed') {
                    console.log(`[RESET CALL] Triggered by: onconnectionstatechange 'closed' for ${peerId}`);
                    resetPeerConnection(peerId);
                }
                 state.updateContactStatus(peerId, false);
                 ui.updateContactStatusUI(peerId, false);
                break;
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

    dc.onopen = () => {
        console.log(`Data channel opened for peer ${peerId}`);
        state.updateDataChannelState(peerId, 'open');

        const pc = state.getPeerConnection(peerId);
        if (pc && (pc.connectionState === 'connected' || pc.connectionState === 'completed')) {
           clearConnectionTimeout(peerId);
           state.updateContactStatus(peerId, true);
           ui.updateContactStatusUI(peerId, true);
           if (state.isActiveChat(peerId)) {
                 ui.updateChatInputVisibility();
           }
           ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的安全连接已建立。`, peerId);

        } else {
             console.warn(`Data channel for ${peerId} opened, but overall connection state is ${pc?.connectionState}. Waiting.`);
             state.updateContactStatus(peerId, 'connecting');
             ui.updateContactStatusUI(peerId, 'connecting');
        }

    };

    dc.onclose = () => {
        console.log(`Data channel closed for peer ${peerId}`);
         state.updateDataChannelState(peerId, 'closed');
         ui.addSystemMessage(`与 ${state.contacts[peerId]?.name || peerId} 的数据通道已关闭。`, peerId);
        console.log(`[RESET CALL] Triggered by: dc.onclose for ${peerId}`);
        resetPeerConnection(peerId);
         state.updateContactStatus(peerId, false);
         ui.updateContactStatusUI(peerId, false);
          if (state.isActiveChat(peerId)) {
                 ui.updateChatInputVisibility();
           }
    };

    dc.onerror = (error) => {
        console.error(`Data channel error for peer ${peerId}:`, error);

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
        console.log(`Raw message received from ${peerId} on channel ${dc.label}`);
        try {
            let messageData;
            let isFileMeta = false;

            if (typeof event.data === 'string') {
                 try {
                     const parsed = JSON.parse(event.data);
                     if (parsed.type === 'fileMeta') {
                         messageData = parsed;
                         isFileMeta = true;
                         console.log(`Received file metadata from ${peerId}:`, messageData.payload);
                     } else if (parsed.type === 'text') {
                         messageData = parsed;
                         console.log(`Received text message object from ${peerId}:`, messageData);
                     } else if (parsed.type === 'typing') {
                          console.log(`Received typing indicator from ${peerId}:`, parsed.payload.isTyping);
                          ui.showTypingIndicator(peerId, parsed.payload.isTyping);
                          return;
                     } else {
                         messageData = { type: 'text', payload: { text: event.data }, timestamp: Date.now() };
                         console.log(`Received plain text string from ${peerId}, wrapping:`, messageData.payload.text);
                     }
                 } catch(e) {
                     messageData = { type: 'text', payload: { text: event.data }, timestamp: Date.now() };
                     console.log(`Received non-JSON string from ${peerId}, wrapping:`, messageData.payload.text);
                 }
            } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
                console.log(`Received binary data chunk from ${peerId} (${event.data.byteLength} bytes)`);
                fileTransfer.handleIncomingDataChunk(peerId, event.data);
                return;
            } else {
                 console.warn(`Received message of unknown type from ${peerId}:`, typeof event.data);
                 messageData = { type: 'unknown', payload: { data: event.data }, timestamp: Date.now() };
            }

            messageData.senderId = peerId;

             if (isFileMeta) {
                 const fileInfo = messageData.payload;
                 const systemMsg = `收到来自 ${state.contacts[peerId]?.name || peerId} 的文件传输请求: ${fileInfo.name} (${formatBytes(fileInfo.size)})`;
                 const messageForUi = {
                     id: messageData.payload.transferId || `file-${Date.now()}`,
                     senderId: peerId,
                     peerId: peerId,
                     type: 'fileMeta',
                     payload: fileInfo,
                     timestamp: messageData.timestamp || Date.now()
                 };
                 await storage.addMessage(messageForUi);
                 ui.displayMessage(peerId, messageForUi);
                 ui.showUnreadIndicator(peerId, true);
                 fileTransfer.handleIncomingFileMeta(peerId, messageData.payload);
             } else if (messageData.type === 'text') {
                  const messageToStore = {
                      id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                      senderId: peerId,
                      peerId: peerId,
                      type: 'text',
                      payload: { text: messageData.payload.text },
                      timestamp: messageData.timestamp || Date.now()
                  };
                 await storage.addMessage(messageToStore);
                 console.log(`Stored message from ${peerId}:`, messageToStore);

                 if (state.isActiveChat(peerId)) {
                     ui.displayMessage(peerId, messageToStore);
                 } else {
                     ui.showUnreadIndicator(peerId, true);
                 }
             } else {
                 console.log(`Not storing or displaying message of type: ${messageData.type}`);
             }

        } catch (e) {
            console.error(`Error processing message from ${peerId}:`, e);
             ui.addSystemMessage(`处理来自 ${state.contacts[peerId]?.name || peerId} 的消息时出错。`, peerId, true);
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

export async function connectToPeer(targetPeerId) {
    if (!targetPeerId) {
        console.error("connectToPeer called without targetPeerId");
        return;
    }

    if (state.getConnectionState(targetPeerId) === 'connected' || state.getConnectionState(targetPeerId) === 'connecting') {
         console.log(`Already connected or connecting to ${targetPeerId}. Ignoring connect request.`);
         return;
    }

    console.log(`Attempting to connect to peer: ${targetPeerId}`);
    console.log(`[RESET CALL] Triggered by: connectToPeer start for ${targetPeerId}`);
    resetPeerConnection(targetPeerId, "Connect Attempt Start");

    // 2. Set initial state for the *new* connection attempt
    ui.addSystemMessage(`正在尝试连接到 ${state.contacts[targetPeerId]?.name || targetPeerId}...`, targetPeerId);
    state.updateContactStatus(targetPeerId, 'connecting');
    state.updateConnectionState(targetPeerId, 'connecting');
    console.log(`[CONNECT] Set connectionState=connecting for ${targetPeerId}`);
    state.setIsMakingOffer(targetPeerId, true);
    console.log(`[CONNECT] Set isMakingOffer=true for ${targetPeerId}`);

    // 3. Create PeerConnection and Data Channel
    const pc = createPeerConnection(targetPeerId);
    if (!pc) {
        console.error(`[CONNECT ERROR] Failed to create PeerConnection for ${targetPeerId}`);
        console.log(`[RESET CALL] Triggered by: connectToPeer PeerConnection Creation Failed for ${targetPeerId}`);
        resetPeerConnection(targetPeerId, "PeerConnection Creation Failed");
        return; // Exit if PC creation failed
    }
    console.log(`[CONNECT] Created PeerConnection for ${targetPeerId}`);

    try {
        console.log(`Creating data channel for ${targetPeerId}`);
        const dc = pc.createDataChannel('chat', { negotiated: false });
        state.setDataChannel(targetPeerId, dc);
        setupDataChannelEvents(targetPeerId, dc);

        // 4. Create and send offer
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

        // 5. Start connection timeout
        console.log(`[RESET CALL] Triggered by: connectToPeer timeout setup for ${targetPeerId}`);
        startConnectionTimeout(targetPeerId);
        console.log(`[CONNECT] Started connection timeout for ${targetPeerId}`);

    } catch (e) {
        console.error(`[CONNECT ERROR] Error initiating connection to ${targetPeerId}:`, e);
        ui.addSystemMessage(`无法发起与 ${state.contacts[targetPeerId]?.name || targetPeerId} 的连接。`, targetPeerId, true);
        console.log(`[RESET CALL] Triggered by: connectToPeer catch block for ${targetPeerId}`);
        resetPeerConnection(targetPeerId, "Connect Initiate Error");
    } finally {
        // Nothing specific needed here now
    }
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

function resetPeerConnection(peerId, reason = "Unknown") {
     if (!peerId) {
         console.warn("resetPeerConnection called without peerId. This might indicate a logic error.");
         return;
     }
    console.log(`[RESET] Resetting connection state for peer: ${peerId}. Reason: ${reason}`);

    clearConnectionTimeout(peerId);

    const pc = state.getPeerConnection(peerId);
    const dc = state.getDataChannel(peerId);

    if (dc) {
        try {
            console.log(`Closing data channel for ${peerId}`);
            dc.close();
        } catch (e) { console.warn(`Error closing data channel for ${peerId}:`, e); }
         state.removeDataChannel(peerId);
    }

    if (pc) {
        try {
            console.log(`Closing PeerConnection for ${peerId}`);
            pc.close();
        } catch (e) { console.warn(`Error closing PeerConnection for ${peerId}:`, e); }
         state.removePeerConnection(peerId);
    }

    state.resetPeerState(peerId);

    if (state.isActiveChat(peerId)) {
        ui.updateChatInputVisibility();
    }
     state.updateContactStatus(peerId, false);
     ui.updateContactStatusUI(peerId, false);

     console.log(`Finished resetting connection for ${peerId}`);
}

export function sendChatMessage(text) {
    const activePeerId = state.getActiveChatPeerId();

    if (!activePeerId) {
        console.warn("sendChatMessage: No active chat selected.");
        ui.addSystemMessage("请先选择一个聊天对象。", null, true);
        return;
    }

    const dc = state.getDataChannel(activePeerId);

    if (dc && dc.readyState === 'open') {
        try {
            const message = {
                 id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                 type: 'text',
                 senderId: state.localUserId,
                 peerId: activePeerId,
                 payload: { text: text },
                 timestamp: Date.now()
            };
            const messageString = JSON.stringify(message);
            dc.send(messageString);
            console.log(`Sent message to ${activePeerId}:`, text);

            storage.addMessage(message);

            ui.displayMessage(activePeerId, message);
            ui.clearChatInput();

        } catch (e) {
            console.error(`Error sending message to ${activePeerId}:`, e);
            ui.addSystemMessage(`发送消息到 ${state.contacts[activePeerId]?.name || activePeerId} 失败。`, activePeerId, true);
        }
    } else {
        console.warn(`Cannot send message: Data channel for ${activePeerId} not open. State: ${dc?.readyState}`);
         ui.addSystemMessage(`无法发送消息：与 ${state.contacts[activePeerId]?.name || activePeerId} 的连接未建立或已断开。`, activePeerId, true);
    }
}

export function sendTypingIndicator(isTyping) {
     const activePeerId = state.getActiveChatPeerId();

    if (!activePeerId) {
        return;
    }

    const dc = state.getDataChannel(activePeerId);

    if (dc && dc.readyState === 'open') {
        try {
            const indicatorMsg = {
                type: 'typing',
                payload: { isTyping: isTyping }
            };
            dc.send(JSON.stringify(indicatorMsg));
        } catch (e) {
            console.error(`Error sending typing indicator to ${activePeerId}:`, e);
        }
    }
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

function startConnectionTimeout(peerId) {
    console.log(`Starting connection timeout for ${peerId}`);
    state.setConnectionTimeout(peerId, setTimeout(() => {
        console.log(`Connection timeout for ${peerId}`);
         ui.addSystemMessage(`连接 ${state.contacts[peerId]?.name || peerId} 超时。`, peerId, true);
         console.log(`[RESET CALL] Triggered by: startConnectionTimeout timeout reached for ${peerId}`);
        resetPeerConnection(peerId);
        state.updateContactStatus(peerId, false);
        ui.updateContactStatusUI(peerId, false);
        state.setIsMakingOffer(peerId, false);
    }, 30000));
}

function clearConnectionTimeout(peerId) {
     console.log(`Clearing connection timeout for ${peerId}`);
    state.clearConnectionTimeout(peerId);
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