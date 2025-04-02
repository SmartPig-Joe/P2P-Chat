// fileTransfer.js
import * as dom from './dom.js';
import * as state from './state.js';
import { FILE_CHUNK_SIZE } from './constants.js';
import * as ui from './ui.js';
import { escapeHTML } from './utils.js';

// --- Sending Files ---

export function handleFileSelect(event) {
    console.log("[Debug] handleFileSelect triggered.");
    if (!state.isConnected || state.remoteUserId !== ui.getSelectedPeerId() || !state.dataChannel || state.dataChannel.readyState !== 'open') {
        const errorMsg = `Cannot send file. State check failed. isConnected: ${state.isConnected}, remoteUserId: ${state.remoteUserId}, selectedPeerId: ${ui.getSelectedPeerId()}, dataChannel exists: ${!!state.dataChannel}, state: ${state.dataChannel?.readyState}`;
        console.warn(`[Debug] handleFileSelect: ${errorMsg}`);
        ui.addSystemMessage("无法发送文件：未连接到当前选中的联系人或数据通道未就绪。", true);
        if(event.target) event.target.value = null;
        return;
    }

    const file = event.target.files[0];
    if (!file) {
        console.log("[Debug] handleFileSelect: No file selected.");
        return;
    }

    console.log(`[Debug] handleFileSelect: Selected file: ${file.name}, Size: ${file.size}, Type: ${file.type}`);
    event.target.value = null;

    const transferId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const recipientPeerId = state.remoteUserId;
    console.log(`[Debug] handleFileSelect: Generated transferId: ${transferId} for recipient: ${recipientPeerId}`);

    const fileInfo = {
        transferId: transferId,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: Date.now(),
        peerId: recipientPeerId
    };

    try {
        const messageToSend = { type: 'file-info', payload: fileInfo };
        state.dataChannel.send(JSON.stringify(messageToSend));
        console.log("Sent file-info:", fileInfo);
        ui.addFileMessageToList(fileInfo, true, null, 0);
        ui.addContactToList(recipientPeerId);
    } catch (e) {
        console.error("[Debug] handleFileSelect: Failed to send file-info:", e);
        ui.addSystemMessage(`发送文件 ${escapeHTML(file.name)} 的信息失败。`, true);
        return;
    }

    console.log(`[Debug] handleFileSelect: Calling sendFileChunks for ${transferId}`);
    sendFileChunks(file, transferId, fileInfo);
}

async function sendFileChunks(file, transferId, fileInfo) {
    console.log(`[Debug] sendFileChunks started for ${transferId}`);
    let offset = 0;
    const fileReader = new FileReader();
    let chunkCount = 0;
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);
    const recipientPeerId = fileInfo.peerId;

    const readNextChunk = () => {
        if (!state.isConnected || state.remoteUserId !== recipientPeerId || !state.dataChannel || state.dataChannel.readyState !== 'open') {
            console.warn(`[${transferId}] Connection lost to ${recipientPeerId} during send. Aborting.`);
            ui.addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断。`, true);
            ui.addFileMessageToList(fileInfo, true, null, -1);
            return;
        }
        const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
        fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = async (e) => {
        const chunk = e.target.result;
        if (!chunk) {
             console.error(`[${transferId}] FileReader returned null chunk.`);
             ui.addSystemMessage(`读取文件 ${escapeHTML(file.name)} 时出错 (null chunk)。`, true);
             ui.addFileMessageToList(fileInfo, true, null, -1);
             return;
        }
        chunkCount++;
        console.log(`Sending chunk ${chunkCount}/${totalChunks} for ${transferId}`);

        try {
            const idBuffer = new TextEncoder().encode(transferId + '|');
            const combinedBuffer = new ArrayBuffer(idBuffer.byteLength + chunk.byteLength);
            const combinedView = new Uint8Array(combinedBuffer);
            combinedView.set(new Uint8Array(idBuffer), 0);
            combinedView.set(new Uint8Array(chunk), idBuffer.byteLength);

            const BUFFER_THRESHOLD = 512 * 1024;
            while (state.dataChannel && state.dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                console.log(`[${transferId}] DataChannel buffer full (${state.dataChannel.bufferedAmount}), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 50));
                 if (!state.isConnected || state.remoteUserId !== recipientPeerId || !state.dataChannel || state.dataChannel.readyState !== 'open') {
                    console.warn(`[${transferId}] Connection lost while waiting for buffer. Aborting.`);
                    ui.addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断 (缓冲区)。`, true);
                    ui.addFileMessageToList(fileInfo, true, null, -1);
                    return;
                }
            }

             if (!state.dataChannel || state.dataChannel.readyState !== 'open' || state.remoteUserId !== recipientPeerId) {
                 console.warn(`[${transferId}] DataChannel closed or connection changed before sending chunk ${chunkCount}. Aborting.`);
                 ui.addSystemMessage(`文件 ${escapeHTML(file.name)} 发送中断 (通道关闭/变更)。`, true);
                 ui.addFileMessageToList(fileInfo, true, null, -1);
                 return;
             }

            state.dataChannel.send(combinedBuffer);
            offset += chunk.byteLength;

            const progress = offset / file.size;
            ui.addFileMessageToList(fileInfo, true, null, progress);

            if (offset < file.size) {
                setTimeout(readNextChunk, 0);
            } else {
                console.log(`[${transferId}] Finished sending all chunks.`);
                const endMessage = { type: 'file-end', payload: { transferId: transferId } };
                try {
                    if (state.dataChannel && state.dataChannel.readyState === 'open' && state.remoteUserId === recipientPeerId) {
                        state.dataChannel.send(JSON.stringify(endMessage));
                         console.log(`[${transferId}] Sent file-end message.`);
                         ui.addFileMessageToList(fileInfo, true, null, 1);
                    } else {
                         console.warn(`[${transferId}] Cannot send file-end, DataChannel closed or connection changed.`);
                         ui.addFileMessageToList(fileInfo, true, null, -1);
                    }
                } catch (endError) {
                     console.error(`[${transferId}] Error sending file-end message:`, endError);
                     ui.addSystemMessage(`发送文件 ${escapeHTML(file.name)} 结束信号失败。`, true);
                     ui.addFileMessageToList(fileInfo, true, null, -1);
                }
            }
        } catch (error) {
            console.error(`[${transferId}] Error sending chunk ${chunkCount}:`, error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            ui.addSystemMessage(`发送文件 ${escapeHTML(file.name)} 的块 ${chunkCount} 失败: ${errorMsg}`, true);
            ui.addFileMessageToList(fileInfo, true, null, -1);
            return;
        }
    };

    fileReader.onerror = (error) => {
        console.error(`[${transferId}] FileReader error:`, error);
        ui.addSystemMessage(`读取文件 ${escapeHTML(file.name)} 时出错。`, true);
        ui.addFileMessageToList(fileInfo, true, null, -1);
    };

    readNextChunk();
}

// --- Receiving Files ---

export function handleIncomingFileInfo(fileInfo) {
    if (!fileInfo || !fileInfo.transferId || !fileInfo.name || typeof fileInfo.size !== 'number' || !fileInfo.senderId) {
        console.error("Received invalid file-info:", fileInfo);
        ui.addSystemMessage("收到无效的文件信息。", true);
        return;
    }
    const transferId = fileInfo.transferId;
    const senderId = fileInfo.senderId;
    console.log(`Received file-info for ${transferId} from ${senderId}:`, fileInfo);

    const currentIncomingFiles = state.incomingFiles;
    if (currentIncomingFiles[transferId]) {
        console.warn(`Received duplicate file-info for transfer ID: ${transferId}. Ignoring.`);
        return;
    }

    currentIncomingFiles[transferId] = {
        info: fileInfo,
        chunks: [],
        receivedSize: 0
    };
    state.setIncomingFiles({...currentIncomingFiles});

    fileInfo.peerId = senderId;
    ui.addFileMessageToList(fileInfo, false, null, 0);
    if (senderId === ui.selectedPeerId) {
        ui.addSystemMessage(`正在接收文件: ${escapeHTML(fileInfo.name)}`);
    }
}

export function handleIncomingFileChunk(arrayBuffer) {
    try {
        const view = new Uint8Array(arrayBuffer);
        let separatorIndex = -1;
        for (let i = 0; i < Math.min(view.length, 60); i++) {
            if (view[i] === 124) {
                separatorIndex = i;
                break;
            }
        }

        if (separatorIndex === -1 || separatorIndex === 0) {
            console.error("Received binary chunk without valid transferId separator.");
            return;
        }

        const idBuffer = arrayBuffer.slice(0, separatorIndex);
        const chunkData = arrayBuffer.slice(separatorIndex + 1);
        const transferId = new TextDecoder().decode(idBuffer);

        const currentIncomingFiles = state.incomingFiles;
        const fileData = currentIncomingFiles[transferId];

        if (!fileData) {
            console.warn(`[${transferId}] Received chunk for unknown/completed transfer ID.`);
            return;
        }

        const senderId = fileData.info.senderId;
        if (!currentIncomingFiles[transferId] || !state.isConnected || state.remoteUserId !== senderId) {
             console.log(`[${transferId}] Ignoring chunk, transfer aborted or sender changed.`);
             if (currentIncomingFiles[transferId]) {
                 delete currentIncomingFiles[transferId];
                 state.setIncomingFiles({...currentIncomingFiles});
                 if (senderId === ui.selectedPeerId) {
                    ui.addFileMessageToList(fileData.info, false, null, -1);
                 }
             }
             return;
        }

        fileData.chunks.push(chunkData);
        fileData.receivedSize += chunkData.byteLength;

        if (fileData.receivedSize > fileData.info.size) {
            console.error(`[${transferId}] Received more data than expected size. Aborting.`);
            ui.addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收数据异常，已中止。`, true);
            delete currentIncomingFiles[transferId];
            state.setIncomingFiles({...currentIncomingFiles});
            ui.addFileMessageToList(fileData.info, false, null, -1);
            return;
        }

        const progress = fileData.receivedSize / fileData.info.size;
        console.log(`[${transferId}] Received chunk ${fileData.chunks.length}. Progress: ${Math.round(progress * 100)}%`);

        ui.addFileMessageToList(fileData.info, false, null, progress);

    } catch (error) {
        console.error("Error processing incoming file chunk:", error);
        ui.addSystemMessage("处理接收到的文件块时出错。", true);
    }
}

export function handleIncomingFileEnd(payload) {
     if (!payload || !payload.transferId) {
        console.error("Received invalid file-end payload:", payload);
        return;
    }
    const transferId = payload.transferId;
    console.log(`[${transferId}] Received file-end signal.`);

    const currentIncomingFiles = state.incomingFiles;
    const fileData = currentIncomingFiles[transferId];

    if (!fileData) {
        console.warn(`[${transferId}] Received file-end for unknown or already handled transfer.`);
        return;
    }

    if (fileData.receivedSize !== fileData.info.size) {
        console.error(`[${transferId}] File transfer incomplete. Expected ${fileData.info.size}, got ${fileData.receivedSize}.`);
        if (fileData.info.senderId === ui.selectedPeerId) {
            ui.addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收不完整。`, true);
        }
        ui.addFileMessageToList(fileData.info, false, null, -1);
        delete currentIncomingFiles[transferId];
        state.setIncomingFiles({...currentIncomingFiles});
        return;
    }

    console.log(`[${transferId}] File received completely. Assembling...`);
    try {
        const fileBlob = new Blob(fileData.chunks, { type: fileData.info.type });
        if (fileBlob.size !== fileData.info.size) {
             console.error(`[${transferId}] Assembled Blob size mismatch! Expected ${fileData.info.size}, got ${fileBlob.size}.`);
             ui.addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 组装后大小不匹配。`, true);
             ui.addFileMessageToList(fileData.info, false, null, -1);
             delete currentIncomingFiles[transferId];
             state.setIncomingFiles({...currentIncomingFiles});
             return;
        }

        const downloadUrl = URL.createObjectURL(fileBlob);
        console.log(`[${transferId}] File assembled. Download URL created.`);

        ui.addFileMessageToList(fileData.info, false, downloadUrl, 1);
        if (fileData.info.senderId === ui.selectedPeerId) {
            ui.addSystemMessage(`文件 ${escapeHTML(fileData.info.name)} 接收完成。`);
        }

    } catch (error) {
        console.error(`[${transferId}] Error creating Blob or Object URL:`, error);
        ui.addSystemMessage(`处理接收到的文件 ${escapeHTML(fileData.info.name)} 时出错。`, true);
        ui.addFileMessageToList(fileData.info, false, null, -1);
    } finally {
         delete currentIncomingFiles[transferId];
         state.setIncomingFiles({...currentIncomingFiles});
         console.log(`[${transferId}] Cleaned up incoming file data.`);
    }
}

// --- Utility / Cleanup ---

export function cleanupFileBlobs() {
    console.warn("cleanupFileBlobs() is not fully implemented. Potential memory leaks from Object URLs.");
} 