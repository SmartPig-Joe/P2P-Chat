// --- File Transfer Constants & State ---
const FILE_CHUNK_SIZE = 16 * 1024; // 16 KB
let incomingFiles = {}; // { transferId: { info: {}, chunks: [], receivedSize: 0 } }

// --- Dependencies (Set via initializeFileTransfer) ---
let deps = {
    getDataChannel: () => null,
    getSharedKey: () => null, // Needed? File transfer itself isn't encrypted yet.
    addSystemMessage: (text, isError) => console.log(`System Message: ${text}, Error: ${isError}`),
    addFileMessageToList: (fileInfo, isLocal, downloadUrl, progress) => console.log(`File Msg: ${fileInfo.name}, Local: ${isLocal}, Progress: ${progress}`),
    escapeHTML: (str) => str // Basic escape fallback
};

/**
 * Initializes the file transfer module with necessary dependencies.
 * @param {object} config Dependencies
 */
export function initializeFileTransfer(config) {
    deps = { ...deps, ...config };
    console.log("File Transfer module initialized.");
}

/**
 * Handles the file selection event from the input element.
 * @param {Event} event The file input change event.
 */
export function handleFileSelect(event) {
    const dataChannel = deps.getDataChannel();
    if (!dataChannel || dataChannel.readyState !== 'open') {
        deps.addSystemMessage("无法发送文件：数据通道未就绪。", true);
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    console.log(`Selected file: ${file.name}, Size: ${file.size}, Type: ${file.type}`);
    event.target.value = null; // Reset input

    const transferId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const fileInfo = {
        transferId: transferId,
        name: file.name,
        size: file.size,
        type: file.type,
        timestamp: Date.now()
    };

    // 1. Send file metadata (unencrypted for now)
    try {
        const messageToSend = { type: 'file-info', payload: fileInfo };
        dataChannel.send(JSON.stringify(messageToSend));
        console.log("Sent file-info:", fileInfo);
        deps.addFileMessageToList(fileInfo, true, null, 0); // Show local progress
    } catch (e) {
        console.error("Failed to send file-info:", e);
        deps.addSystemMessage(`发送文件 ${deps.escapeHTML(file.name)} 的信息失败。`, true);
        return;
    }

    // 2. Send file chunks
    sendFileChunks(file, transferId, fileInfo, dataChannel);
}

/**
 * Reads a file and sends it in chunks over the data channel.
 * @param {File} file The file to send.
 * @param {string} transferId Unique ID for the transfer.
 * @param {object} fileInfo Metadata about the file.
 * @param {RTCDataChannel} channel The data channel to use.
 */
async function sendFileChunks(file, transferId, fileInfo, channel) {
    let offset = 0;
    const fileReader = new FileReader();
    let chunkCount = 0;
    const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE);
    const BUFFER_THRESHOLD = 512 * 1024; // 512KB buffer limit

    const readNextChunk = () => {
        const slice = file.slice(offset, offset + FILE_CHUNK_SIZE);
        fileReader.readAsArrayBuffer(slice);
    };

    fileReader.onload = async (e) => {
        const chunk = e.target.result;
        chunkCount++;
        console.log(`Sending chunk ${chunkCount}/${totalChunks} for ${transferId}`);

        try {
            // Prepend transferId (unencrypted)
            const idBuffer = new TextEncoder().encode(transferId + '|');
            const combinedBuffer = new ArrayBuffer(idBuffer.byteLength + chunk.byteLength);
            const combinedView = new Uint8Array(combinedBuffer);
            combinedView.set(new Uint8Array(idBuffer), 0);
            combinedView.set(new Uint8Array(chunk), idBuffer.byteLength);

            // Wait if buffer is full
            while (channel.bufferedAmount > BUFFER_THRESHOLD) {
                console.log(`DataChannel buffer full (${channel.bufferedAmount}), waiting...`);
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            channel.send(combinedBuffer);
            offset += chunk.byteLength;

            // Update local UI progress
            const progress = offset / file.size;
            deps.addFileMessageToList(fileInfo, true, null, progress);

            if (offset < file.size) {
                readNextChunk();
            } else {
                // Send end signal (unencrypted)
                console.log(`Finished sending all chunks for ${transferId}`);
                const endMessage = { type: 'file-end', payload: { transferId: transferId } };
                channel.send(JSON.stringify(endMessage));
                console.log("Sent file-end message.");
                deps.addFileMessageToList(fileInfo, true, null, 1); // Mark as complete locally
            }
        } catch (error) {
            console.error(`Error sending chunk for ${transferId}:`, error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            deps.addSystemMessage(`发送文件 ${deps.escapeHTML(fileInfo.name)} 的块失败: ${errorMsg}`, true);
            // TODO: Add cancellation mechanism?
        }
    };

    fileReader.onerror = (error) => {
        console.error("FileReader error:", error);
        deps.addSystemMessage(`读取文件 ${deps.escapeHTML(fileInfo.name)} 时出错。`, true);
    };

    readNextChunk(); // Start the process
}

/**
 * Handles an incoming binary chunk presumed to be part of a file transfer.
 * @param {ArrayBuffer} arrayBuffer The received binary data.
 */
export function handleIncomingFileChunk(arrayBuffer) {
    try {
        const view = new Uint8Array(arrayBuffer);
        let separatorIndex = -1;
        for (let i = 0; i < Math.min(view.length, 50); i++) {
            if (view[i] === 124) { // '|'
                separatorIndex = i;
                break;
            }
        }

        if (separatorIndex === -1) {
            console.error("Received binary chunk without valid transferId separator.");
            return;
        }

        const idBuffer = arrayBuffer.slice(0, separatorIndex);
        const chunkData = arrayBuffer.slice(separatorIndex + 1);
        const transferId = new TextDecoder().decode(idBuffer);

        const fileData = incomingFiles[transferId];
        if (!fileData) {
            console.warn(`Received chunk for unknown/uninitialized transfer ID: ${transferId}`);
            return; // Need file-info first
        }

        fileData.chunks.push(chunkData);
        fileData.receivedSize += chunkData.byteLength;

        const progress = fileData.receivedSize / fileData.info.size;
        console.log(`Received chunk for ${transferId}. Progress: ${Math.round(progress * 100)}%`);

        // Update UI progress for the receiver
        deps.addFileMessageToList(fileData.info, false, null, progress);

    } catch (error) {
        console.error("Error processing incoming file chunk:", error);
        // Avoid adding system message for every chunk error potentially
    }
}

/**
 * Handles the file-info message to initialize a file transfer reception.
 * @param {object} fileInfo Metadata about the incoming file.
 */
export function handleIncomingFileInfo(fileInfo) {
    if (!fileInfo || !fileInfo.transferId || !fileInfo.name || typeof fileInfo.size !== 'number') {
        console.error("Received invalid file-info:", fileInfo);
        deps.addSystemMessage("收到无效的文件信息。", true);
        return;
    }
    const transferId = fileInfo.transferId;
    console.log(`Received file-info for ${transferId}:`, fileInfo);

    if (incomingFiles[transferId]) {
        console.warn(`Received duplicate file-info for transfer ID: ${transferId}. Ignoring.`);
        return;
    }

    // Initialize storage for incoming file
    incomingFiles[transferId] = {
        info: fileInfo,
        chunks: [],
        receivedSize: 0
    };

    // Display message/progress locally for the receiver
    deps.addFileMessageToList(fileInfo, false, null, 0);
    deps.addSystemMessage(`正在接收文件: ${deps.escapeHTML(fileInfo.name)}`);
}

/**
 * Handles the file-end message to finalize a file transfer reception.
 * @param {object} payload Contains the transferId.
 */
export function handleIncomingFileEnd(payload) {
    if (!payload || !payload.transferId) {
        console.error("Received invalid file-end payload:", payload);
        return;
    }
    const transferId = payload.transferId;
    console.log(`Received file-end for ${transferId}`);

    const fileData = incomingFiles[transferId];
    if (!fileData) {
        console.warn(`Received file-end for unknown or already completed transfer ID: ${transferId}`);
        return;
    }

    if (fileData.receivedSize !== fileData.info.size) {
        console.error(`File transfer incomplete for ${transferId}. Expected ${fileData.info.size}, got ${fileData.receivedSize}.`);
        deps.addSystemMessage(`文件 ${deps.escapeHTML(fileData.info.name)} 接收不完整。`, true);
        // Update UI to show incomplete status
        deps.addFileMessageToList(fileData.info, false, null, fileData.receivedSize / fileData.info.size);
        delete incomingFiles[transferId]; // Clean up partial data
        return;
    }

    console.log(`File ${transferId} received completely. Assembling...`);
    try {
        const fileBlob = new Blob(fileData.chunks, { type: fileData.info.type });
        const downloadUrl = URL.createObjectURL(fileBlob);

        console.log(`File ${transferId} assembled. Download URL generated.`);

        // Update the message UI to show the download link
        deps.addFileMessageToList(fileData.info, false, downloadUrl, 1); // Progress 1 indicates completion
        deps.addSystemMessage(`文件 ${deps.escapeHTML(fileData.info.name)} 接收完成。`);

    } catch (error) {
        console.error(`Error creating Blob or Object URL for ${transferId}:`, error);
        deps.addSystemMessage(`处理接收到的文件 ${deps.escapeHTML(fileData.info.name)} 时出错。`, true);
    } finally {
        // Clean up stored chunks after processing (success or fail)
        delete incomingFiles[transferId];
    }
}

/**
 * Clears any incomplete incoming file transfers.
 * Should be called on disconnection/reset.
 */
export function clearIncompleteTransfers() {
    console.log("Clearing incomplete file transfers.");
    incomingFiles = {};
} 