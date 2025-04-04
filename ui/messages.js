// ui/messages.js
import * as dom from '../src/dom.js';
import * as state from '../src/state.js';
import { escapeHTML, formatTime, getUserColorClass, formatBytes } from '../src/utils.js';
import { getAvatarColor, addObjectURLToTrack, untrackAndRevokeObjectURL } from './main.js'; // Import from ui/main.js
import { updateEmptyState } from './chatArea.js';
import { showUnreadIndicator } from './contactList.js'; // Needed for inactive chat message handling

/**
 * Returns the currently selected peer ID from state.
 * @returns {string | null}
 */
export function getSelectedPeerId() {
    return state.getActiveChatPeerId();
}

/**
 * Scrolls the message list to the bottom.
 */
export function scrollToBottom() {
    if (dom.messageList) {
        setTimeout(() => {
             dom.messageList.scrollTop = dom.messageList.scrollHeight;
        }, 0);
    }
}

/**
 * Clears text, system, and file messages from the message list UI.
 * Revokes any active ObjectURLs associated with file messages.
 */
export function clearMessageList() {
    if (dom.messageList) {
        dom.messageList.querySelectorAll('.file-content[data-transfer-id]').forEach(el => {
            const url = el.closest('.message-item')?.dataset.downloadUrl; // Get URL from parent message item
            if (url && url.startsWith('blob:')) {
                console.log(`[UI Cleanup] Revoking ObjectURL during clearMessageList: ${url}`);
                // URL.revokeObjectURL(url); // Revocation handled by untrackAndRevokeObjectURL
                untrackAndRevokeObjectURL(url); // Use the tracking function
            }
        });
        dom.messageList.innerHTML = '';
        updateEmptyState();
    }
}


// --- System Messages ---
// Modified to accept optional peerId. Only displays if peerId matches active chat or if peerId is null (global message).
export function addSystemMessage(text, peerId = null, isError = false) {
     const activePeerId = state.getActiveChatPeerId();

     // Display message only if it's global (peerId is null) or targets the active chat
     if (dom.messageList && (peerId === null || peerId === activePeerId)) {
         const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted';
         const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`;
         dom.messageList.insertAdjacentHTML('beforeend', messageHTML);
         scrollToBottom();
     } else {
         // Log messages for non-active chats or if messageList isn't available
         console.log(`[System Message${peerId ? ` for ${peerId}` : ''}${isError ? ' ERROR' : ''}: ${text}`);
     }
     // Always update empty state in case this is the first message (e.g., error before chat loads)
     if (peerId === activePeerId || peerId === null) {
        updateEmptyState();
     }
}

// --- NEW: Show error when message sent to someone who removed you ---
export function showNotFriendError(peerId) {
    const contacts = state.getContacts(); // USE GETTER
    const contactName = contacts[peerId]?.name || peerId; // Use getter result
    const errorMessage = `您的消息未能发送，因为 ${escapeHTML(contactName)} 已将您从好友列表移除。`;
    addSystemMessage(errorMessage, peerId, true); // Show error in the specific chat window
}
// --- END NEW ---

// --- Chat Messages ---
function renderMessageContent(text) {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
    // Basic markdown for bold and italics
    let processedText = escapeHTML(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.*?)\*/g, '<em>$1</em>');       // Italics

    return processedText.replace(urlRegex, function(url) {
        // Make sure the URL inside <a> tag is not escaped
        return `<a href="${url.replace(/&amp;/g, '&')}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${url}</a>`;
    });
}

// Renders HTML for a single message object (text or file meta)
function createMessageHTML(message) {
    // Add check for missing message or essential properties
    if (!message || !message.timestamp) {
        console.warn("createMessageHTML called with invalid message object:", message);
        return '<div class="text-discord-text-muted text-xs italic p-2">[无效或损坏的消息]</div>'; // Return placeholder HTML
    }

    // Robust handling for potentially missing senderId
    let senderId = message.senderId;
    let senderName = '未知用户'; // Default sender name
    let isLocal = false;

    if (senderId) {
        isLocal = senderId === state.localUserId;
        const contacts = state.getContacts(); // USE GETTER
        senderName = isLocal
            ? state.getLocalUserNickname() // USE GETTER
            : (contacts[senderId]?.name || senderId); // Use getter result
    } else {
        console.warn('Message object missing senderId:', message);
        senderId = 'unknown'; // Assign a default ID for color/avatar generation
    }

    const avatarColor = getAvatarColor(senderId); // Use potentially defaulted senderId
    const userColorClass = getUserColorClass(senderName); // Use potentially defaulted senderName
    const timeString = formatTime(new Date(message.timestamp));

    // TODO: Update lock icon logic based on per-peer crypto state if implemented
    const lockIcon = ''; // Placeholder for now

    const avatarText = escapeHTML(senderName.charAt(0).toUpperCase()); // Use potentially defaulted senderName
    const senderNameEscaped = escapeHTML(senderName); // Use potentially defaulted senderName

    let messageBodyHTML;

    if (message.type === 'text') {
        // Add check for missing payload or text
        if (message.payload && typeof message.payload.text === 'string') {
            messageBodyHTML = `<p class="text-discord-text-primary text-sm message-content">${renderMessageContent(message.payload.text)}</p>`;
        } else {
            console.warn('Text message missing payload or text content:', message);
            messageBodyHTML = '<p class="text-discord-text-muted text-xs italic">[消息内容丢失或损坏]</p>';
        }
    } else if (message.type === 'fileMeta') {
        // Add check for missing payload
        if (message.payload) {
            // Pass initial state (progress=0, no downloadUrl)
            messageBodyHTML = createFileContentHTML(message.payload, isLocal, null, 0);
        } else {
            console.warn('FileMeta message missing payload:', message);
            messageBodyHTML = '<p class="text-discord-text-muted text-xs italic">[文件信息丢失或损坏]</p>';
        }
    } else {
        messageBodyHTML = `<p class="text-discord-text-muted text-sm italic">[不支持的消息类型: ${escapeHTML(message.type)}]</p>`;
    }

    // Use data attributes for easy identification
    // Store transferId in data-message-id for file messages
    const messageId = message.type === 'fileMeta' ? message.payload?.transferId || message.id : message.id;
    const dataAttributes = `data-message-id="${messageId}" data-sender-id="${senderId}" data-timestamp="${message.timestamp}"`;
    const messageClasses = `flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded ${message.type === 'fileMeta' ? 'file-message-container' : ''}`;

    // Use local user info for self-avatar
    const avatarSrc = isLocal
        ? ((state.getLocalUserAvatar() && state.getLocalUserAvatar() !== 'default_avatar.png') ? escapeHTML(state.getLocalUserAvatar()) : `https://placehold.co/40x40/${getAvatarColor(senderId)}/ffffff?text=${escapeHTML(senderName.charAt(0).toUpperCase())}`) // Use state avatar if valid, else fallback - USE GETTER
        : `https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(senderName.charAt(0).toUpperCase())}`; // Default for others

    return (
       `<div class="${messageClasses}" ${dataAttributes}>
            <img src="${avatarSrc}" alt="${senderNameEscaped} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer w-10 h-10 object-cover" title="${senderNameEscaped} (${senderId})" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${senderNameEscaped}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(message.timestamp).toLocaleString('zh-CN')}">${timeString}</span>
                    ${lockIcon}
                </div>
                ${messageBodyHTML}
            </div>
        </div>`
    );
}

// Displays a message object (text or file meta) in the chat window IF it belongs to the active chat.
export function displayMessage(peerId, message) {
    const activePeerId = state.getActiveChatPeerId();
    if (dom.messageList && peerId === activePeerId) {
        const messageElement = document.createElement('div');
        // createMessageHTML creates the outer div structure directly
        messageElement.innerHTML = createMessageHTML(message);
        if (messageElement.firstElementChild) {
            // Special handling for file messages: Check if placeholder exists
            if (message.type === 'fileMeta') {
                const transferId = message.payload?.transferId || message.id; // Use transferId for lookup
                const existingElement = dom.messageList.querySelector(`[data-message-id="${transferId}"]`);
                if (existingElement) {
                     console.log(`Updating existing file message placeholder for ${transferId}`);
                     existingElement.outerHTML = messageElement.innerHTML; // Replace placeholder
                } else {
                     dom.messageList.appendChild(messageElement.firstElementChild);
                }
            } else {
                 dom.messageList.appendChild(messageElement.firstElementChild);
            }
        }
        scrollToBottom();
        updateEmptyState();
    } else if (peerId !== activePeerId) {
        // If message is for an inactive chat, just ensure the unread indicator is shown
         console.log(`Message received for inactive chat ${peerId}, setting unread state and showing indicator.`);
         // NEW: Set unread state
         state.setHasUnreadMessages(peerId, true);
         // END NEW
         showUnreadIndicator(peerId, true); // Ensure indicator is on
    }
}

// --- File Messages (Refactored) ---

// Renders just the content part of a file message (icon, name, size, status/action OR image preview)
// Used by createMessageHTML and updateFileMessageProgress
function createFileContentHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    // Use formatBytes imported from utils.js
    const fileSizeFormatted = formatBytes(fileInfo.size);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;
    const localPreviewUrl = fileInfo.localPreviewUrl; // <<< Get local preview URL
    // Store original size and name as data attributes for later updates
    const dataAttrs = `data-transfer-id="${transferId}" data-file-size="${fileInfo.size}" data-file-name="${fileNameEscaped}" data-file-type="${escapeHTML(fileInfo.type || '')}"`; // Add file type

    const fileIconClasses = "material-symbols-outlined text-3xl text-discord-text-muted flex-shrink-0 mr-3";
    const downloadIconClasses = "material-symbols-outlined text-xl";
    const checkIconClasses = "material-symbols-outlined text-xl text-discord-green";
    const errorIconClasses = "material-symbols-outlined text-xl text-discord-red";
    const progressIconClasses = "material-symbols-outlined text-xl text-discord-blurple animate-spin"; // Spinning icon for progress

    let statusText = '';
    let iconHTML = `<span class="${fileIconClasses}">description</span>`; // Default file icon
    let actionHTML = ''; // Initialize actionHTML, will be placed inside the container
    let contentBodyHTML = ''; // To hold either file info or image preview

    const isFailed = progress < 0;
    const isComplete = progress >= 1;
    const isImage = fileInfo.type && fileInfo.type.startsWith('image/');

    // --- Logic for rendering ---

    // <<< NEW: Handle Local Image Preview FIRST >>>
    if (isLocal && isImage && localPreviewUrl) {
        console.log(`[UI Create ${transferId}] Rendering local image preview.`);
        iconHTML = '';
        statusText = ''; // No status text needed initially for preview
        actionHTML = ''; // No action needed initially
        contentBodyHTML = `
            <a href="${localPreviewUrl}" target="_blank" rel="noopener noreferrer" title="在新标签页打开图片: ${fileNameEscaped}" class="block max-w-xs max-h-64 rounded overflow-hidden cursor-pointer group relative">
                <img src="${localPreviewUrl}" alt="${fileNameEscaped}" class="max-w-full max-h-64 object-contain group-hover:opacity-80 transition-opacity">
                <div class="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                   ${fileNameEscaped} (${fileSizeFormatted})
                   <span class="material-symbols-outlined text-sm align-middle ml-1">open_in_new</span>
                   <!-- Add a sending indicator? -->
                   <span class="material-symbols-outlined text-sm align-middle ml-1 sending-indicator text-discord-text-muted" title="发送中">schedule_send</span>
                </div>
            </a>`;
        // We don't track localPreviewUrl here again, it was tracked in fileTransfer.js

    } else if (isFailed) {
        statusText = `<div class="text-xs text-discord-red">${fileSizeFormatted} - 传输失败</div>`;
        iconHTML = `<span class="${errorIconClasses} flex-shrink-0 mr-3">error</span>`;
        actionHTML = '';
        // Render standard file info even on failure
        contentBodyHTML = `
            <div class="flex-1 min-w-0">\
                 <div class="font-medium text-discord-text-link truncate" title="${fileNameEscaped}">${fileNameEscaped}</div>\
                 ${statusText}\
            </div>`;
    } else if (isComplete) { // This block now primarily handles receiver completion, or sender non-image completion
        if (downloadUrl) { // Receiver completed download
            if (isImage) {
                // --- Render Image Preview --- (Receiver)
                iconHTML = ''; // No separate icon for images
                statusText = ''; // No separate status text
                actionHTML = ''; // Action is the clickable image itself
                contentBodyHTML = `
                    <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer" title="在新标签页打开图片: ${fileNameEscaped}" class="block max-w-xs max-h-64 rounded overflow-hidden cursor-pointer group relative">
                        <img src="${downloadUrl}" alt="${fileNameEscaped}" class="max-w-full max-h-64 object-contain group-hover:opacity-80 transition-opacity">
                        <div class="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                           ${fileNameEscaped} (${fileSizeFormatted})
                           <span class="material-symbols-outlined text-sm align-middle ml-1">open_in_new</span>
                        </div>
                    </a>`;
                addObjectURLToTrack(downloadUrl); // Track the URL
            } else {
                // --- Render Standard File Info (Completed Download - Receiver Non-Image) ---
                statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted}</div>`;
                actionHTML = `
                    <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white p-1 rounded hover:bg-discord-gray-3 download-link" title="下载 ${fileNameEscaped}">
                        <span class="${downloadIconClasses}">download</span>
                    </a>`;
                 addObjectURLToTrack(downloadUrl); // Track the URL
                 // Standard file info body
                 contentBodyHTML = `
                    <div class="flex-1 min-w-0">\
                         <div class="font-medium text-discord-text-link truncate" title="${fileNameEscaped}">${fileNameEscaped}</div>\
                         ${statusText}\
                    </div>`;
            }
        } else if (isLocal) { // Sender completed upload (Non-Image, Image handled by updateFileMessageProgress)
            // This will likely only be hit if update logic fails or runs before create
            statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已发送</div>`;
            iconHTML = `<span class="${checkIconClasses} flex-shrink-0 mr-3">check_circle</span>`;
            actionHTML = ''; // No action needed for sender on completion
            contentBodyHTML = `
                <div class="flex-1 min-w-0">\
                     <div class="font-medium text-discord-text-link truncate" title="${fileNameEscaped}">${fileNameEscaped}</div>\
                     ${statusText}\
                </div>`;
        } else { // Receiver completed (fallback if no URL or not image)
             statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已接收</div>`;
             iconHTML = `<span class="${checkIconClasses} flex-shrink-0 mr-3">check_circle</span>`;
             actionHTML = ''; // No action if download URL missing or not applicable
             contentBodyHTML = `
                <div class="flex-1 min-w-0">\
                     <div class="font-medium text-discord-text-link truncate" title="${fileNameEscaped}">${fileNameEscaped}</div>\
                     ${statusText}\
                </div>`;
        }
    } else { // In progress (and not a local image preview)
        const progressPercent = Math.round(progress * 100);
        statusText = `
            <div class="text-xs text-discord-text-muted">${isLocal ? '正在发送' : '正在接收'} ${progressPercent}%</div>
            <div class="w-full bg-discord-gray-1 rounded-full h-1 mt-1 overflow-hidden">
                <div class="bg-discord-blurple h-1 rounded-full" style="width: ${progressPercent}%"></div>
            </div>`;
        iconHTML = `<span class="${progressIconClasses} flex-shrink-0 mr-3 animate-spin">sync</span>`; // Add animate-spin here directly
        contentBodyHTML = `
            <div class="flex-1 min-w-0">\
                 <div class="font-medium text-discord-text-link truncate" title="${fileNameEscaped}">${fileNameEscaped}</div>\
                 ${statusText}\
            </div>`;
    }
    // --- End Rendering Logic ---

    // Determine container class based on content type
    const containerClasses = (isImage && isComplete && downloadUrl && !isLocal) || (isImage && isLocal && localPreviewUrl)
        ? "mt-1 relative file-content image-preview-container" // Image preview container (receiver or sender)
        : "mt-1 bg-discord-gray-3 p-3 rounded-lg flex items-center file-content"; // Standard file container

    // Assemble the final HTML
    // For images, contentBodyHTML contains the full <a><img> structure
    // For files, it contains the text part, and we add icon and action button around it
    return `
        <div class="${containerClasses}" ${dataAttrs}>
            ${(isImage && ((isComplete && downloadUrl && !isLocal) || (isLocal && localPreviewUrl))) ? '' : iconHTML}
            ${contentBodyHTML}
            ${(isImage && ((isComplete && downloadUrl && !isLocal) || (isLocal && localPreviewUrl))) ? '' : `<div class="file-action-container ml-auto flex-shrink-0 pl-2">${actionHTML}</div>`}
        </div>
    `;
}

// Updates the progress/status of an existing file message in the UI
export function updateFileMessageProgress(peerId, transferId, progress, downloadUrl = null) {
    console.log(`[UI Update] updateFileMessageProgress called for peer ${peerId}, transfer ${transferId}, progress ${progress}, url ${downloadUrl}`);

    const activePeerId = state.getActiveChatPeerId();
    if (peerId !== activePeerId) {
        console.log(`[UI Update] Skipping update for inactive peer ${peerId} (active: ${activePeerId})`);
        return; // Only update visible chat
    }

    if (dom.messageList) {
        // Use transferId (stored in data-message-id for file messages) to find the element
        const messageElement = dom.messageList.querySelector(`.message-item[data-message-id="${transferId}"]`);
        if (messageElement) {
            const fileContentElement = messageElement.querySelector('.file-content');
            if (!fileContentElement) {
                 console.warn(`[UI Update] Could not find .file-content within message element for transfer ${transferId}`);
                 return;
            }
            console.log(`[UI Update] Found messageElement and fileContentElement for ${transferId}`);

            // Read static file info from data attributes
            const fileSize = parseInt(fileContentElement.dataset.fileSize || '0', 10);
            const fileName = fileContentElement.dataset.fileName || 'unknown_file';
            const fileType = fileContentElement.dataset.fileType || ''; // <<< Get file type
            const fileSizeFormatted = formatBytes(fileSize);
            console.log(`[UI Update] Read from data attributes - Size: ${fileSize}, Name: ${fileName}, Type: ${fileType}`);

            const isLocal = messageElement.getAttribute('data-sender-id') === state.localUserId;

            // --- State Check using data attribute ---
            const hasReachedFinalState = messageElement.dataset.transferState === 'complete' || messageElement.dataset.transferState === 'failed' || messageElement.dataset.transferState === 'delivered';
            const isNewStateInProgress = progress >= 0 && progress < 1;

            if (hasReachedFinalState && isNewStateInProgress) {
                console.warn(`[UI Update ${transferId}] Ignoring attempt to set 'in progress' (progress: ${progress}) on an already completed/failed/delivered transfer.`);
                return; // Prevent resetting UI from final state back to in-progress
            }
             // If the update is for a final state, but the current state is already a *different* final state, ignore.
             const isNewStateFinal = progress < 0 || progress >= 1;
             if (hasReachedFinalState && isNewStateFinal) {
                  const newState = progress < 0 ? 'failed' : 'complete'; // 'complete' covers sender complete, receiver complete, delivered
                  const currentState = messageElement.dataset.transferState;
                  if (newState !== currentState && !(newState === 'complete' && currentState === 'delivered')) { // Allow complete->delivered update, but not others
                     console.warn(`[UI Update ${transferId}] Ignoring attempt to set final state '${newState}' on an already final state '${currentState}'.`);
                     return;
                  }
             }
            // --- END State Check ---

            // --- Update Logic ---
            const isFailed = progress < 0;
            const isComplete = progress >= 1;
            const isImage = fileType.startsWith('image/'); // <<< Check if it's an image

            // <<< NEW: Prevent overwriting local image preview on sender completion >>>
            if (isComplete && isLocal && isImage) {
                console.log(`[UI Update ${transferId}] Sender completed image upload. Keeping preview, updating indicator.`);
                // Optionally update an indicator within the preview (e.g., remove 'sending' icon)
                const sendingIndicator = fileContentElement.querySelector('.sending-indicator');
                if (sendingIndicator) {
                    // Replace sending icon with a checkmark
                     sendingIndicator.textContent = 'check_circle';
                     sendingIndicator.classList.remove('text-discord-text-muted'); // Remove muted color
                     sendingIndicator.classList.add('text-discord-green'); // Make it green
                     sendingIndicator.title = '已发送';
                }
                // Mark as complete in dataset (will be handled commonly below)
                // return; // IMPORTANT: Do NOT return here, let common state update run
            }
            // --- End Local Image Completion Handling ---

            if (isComplete && downloadUrl && isImage && !isLocal) {
                // --- SPECIAL CASE: Update to Image Preview for Receiver ---
                console.log(`[UI Update ${transferId}] Completed receiver download is an image. Updating to preview.`);

                const imagePreviewHTML = `
                    <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer" title="在新标签页打开图片: ${fileName}" class="block max-w-xs max-h-64 rounded overflow-hidden cursor-pointer group relative">
                        <img src="${downloadUrl}" alt="${fileName}" class="max-w-full max-h-64 object-contain group-hover:opacity-80 transition-opacity">
                        <div class="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                           ${fileName} (${fileSizeFormatted})
                           <span class="material-symbols-outlined text-sm align-middle ml-1">open_in_new</span>
                        </div>
                    </a>`;

                // Replace the entire content element's structure
                fileContentElement.innerHTML = imagePreviewHTML;
                // Update container classes
                fileContentElement.className = 'mt-1 relative file-content image-preview-container';

                // Track URL
                addObjectURLToTrack(downloadUrl);
                // Store URL in dataset
                messageElement.dataset.downloadUrl = downloadUrl;

            } else if (!(isComplete && isLocal && isImage)) { // <<< Exclude local image completion case here
                 // --- STANDARD UPDATE LOGIC (Progress, Fail, Complete Non-Image, Complete Sender Non-Image) ---
                 let newIconClass = 'description'; // Default file icon
                 let newIconColorClass = 'text-discord-text-muted';
                 let newStatusHTML = '';
                 let spinClass = false;

                 if (isFailed) {
                     newIconClass = 'error';
                     newIconColorClass = 'text-discord-red';
                     const statusText = `${fileSizeFormatted} - 传输失败`;
                     newStatusHTML = `<div class="text-xs text-discord-red">${statusText}</div>`;
                 } else if (isComplete) { // Handles non-image completion for receiver/sender, or fallback
                     let statusText = fileSizeFormatted;
                     newIconClass = 'description'; // Default for non-image receiver complete
                     if (downloadUrl && !isImage) { // Receiver completed non-image with URL
                          // Status text remains just the size
                     } else if (isLocal) { // Sender completed (Non-Image ONLY, Image handled above)
                         newIconClass = 'check_circle';
                         newIconColorClass = 'text-discord-green';
                         statusText = `${fileSizeFormatted} - 已发送`;
                     } else { // Receiver completed (fallback if no URL or image handled above)
                         newIconClass = 'check_circle';
                         newIconColorClass = 'text-discord-green';
                         statusText = `${fileSizeFormatted} - 已接收`;
                     }
                     newStatusHTML = `<div class="text-xs text-discord-text-muted">${statusText}</div>`;
                 } else { // In progress
                     const progressPercent = Math.round(progress * 100);
                     newIconClass = 'sync';
                     newIconColorClass = 'text-discord-blurple';
                     spinClass = true;
                     const statusText = `${isLocal ? '正在发送' : '正在接收'} ${progressPercent}%`; // Removed filesize from progress for brevity
                     newStatusHTML = `
                        <div class="text-xs text-discord-text-muted">${statusText}</div>
                        <div class="w-full bg-discord-gray-1 rounded-full h-1 mt-1 overflow-hidden">
                            <div class="bg-discord-blurple h-1 rounded-full" style="width: ${progressPercent}%"></div>
                        </div>`;
                 }
                 console.log(`[UI Update ${transferId}] Determined state: isFailed=${isFailed}, isComplete=${isComplete}, spinClass=${spinClass}, newStatusHTML='${newStatusHTML}'`);

                // Find elements again in case they were modified/removed
                const iconElement = fileContentElement.querySelector('.material-symbols-outlined:not(.text-sm)'); // Avoid grabbing small icons inside status/action
                const statusContainer = fileContentElement.querySelector('.flex-1.min-w-0');
                const actionContainer = fileContentElement.querySelector('.file-action-container');

                // Apply Updates
                // 1. Update Icon (if it exists)
                if (iconElement) {
                    console.log(`[UI Update ${transferId}] Updating icon to: ${newIconClass}, Color: ${newIconColorClass}, Spin: ${spinClass}`);
                    iconElement.textContent = newIconClass;
                    // More robust class update
                    const baseIconClasses = "material-symbols-outlined text-3xl flex-shrink-0 mr-3";
                    iconElement.className = `${baseIconClasses} ${newIconColorClass}`;
                    iconElement.classList.toggle('animate-spin', spinClass);
                } else if (!isComplete || !downloadUrl || !isImage){ // Only warn if icon is expected
                     console.warn(`[UI Update ${transferId}] Icon element not found (standard update).`);
                }


                // 2. Update Status Area (if it exists)
                if (statusContainer) {
                    const filenameDiv = statusContainer.querySelector('.font-medium.text-discord-text-link');
                    if (filenameDiv) {
                        console.log(`[UI Update ${transferId}] Rebuilding status container content (standard update).`);
                        const tempFilenameDiv = filenameDiv.cloneNode(true);
                        statusContainer.innerHTML = ''; // Clear everything
                        statusContainer.appendChild(tempFilenameDiv); // Add filename back
                        statusContainer.insertAdjacentHTML('beforeend', newStatusHTML); // Add new status/progress
                    } else {
                         console.warn(`[UI Update ${transferId}] Filename div not found in status container (standard update). Setting innerHTML directly.`);
                         const fallbackFilenameHTML = `<div class="font-medium text-discord-text-link truncate" title="${fileName}">${fileName}</div>`;
                         statusContainer.innerHTML = fallbackFilenameHTML + newStatusHTML;
                    }
                } else if (!isComplete || !downloadUrl || !isImage) { // Only warn if status is expected
                     console.warn(`[UI Update ${transferId}] Status container (.flex-1.min-w-0) not found (standard update).`);
                }


                 // 3. Update Action Area (Download Link) (if it exists)
                 // Revoke old URL *before* potentially creating a new one
                 const oldUrl = messageElement.dataset.downloadUrl;
                 if (oldUrl && downloadUrl && oldUrl !== downloadUrl) {
                     console.log(`[UI Update ${transferId}] Revoking old ObjectURL: ${oldUrl}`);
                     untrackAndRevokeObjectURL(oldUrl);
                 }

                 if (actionContainer) {
                     if (isComplete && downloadUrl && !isImage) { // Only add download link for non-images
                         console.log(`[UI Update ${transferId}] Transfer complete for receiver (non-image). Updating download link. URL: ${downloadUrl}`);
                         let linkElement = actionContainer.querySelector('a.download-link');
                         if (!linkElement) {
                             console.log(`[UI Update ${transferId}] Download link <a> not found, creating new one.`);
                             linkElement = document.createElement('a');
                             linkElement.className = 'text-discord-text-muted hover:text-white p-1 rounded hover:bg-discord-gray-3 download-link';
                             linkElement.title = `下载 ${fileName}`; // Add filename to title
                             linkElement.innerHTML = '<span class="material-symbols-outlined text-xl">download</span>';
                             actionContainer.innerHTML = ''; // Clear previous actions
                             actionContainer.appendChild(linkElement);
                         }
                         linkElement.href = downloadUrl;
                         linkElement.download = fileName;
                         linkElement.classList.remove('hidden');
                         console.log(`[UI Update ${transferId}] Download link href set to: ${linkElement.href}, download attribute to: ${linkElement.download}`);

                         // Add the URL to the active set
                         addObjectURLToTrack(downloadUrl);
                         // Store new URL in dataset
                         messageElement.dataset.downloadUrl = downloadUrl;

                     } else if (isComplete || isFailed) { // Clear action for non-image complete or any failure
                         console.log(`[UI Update ${transferId}] Transfer complete for sender (non-image) or failed. Clearing action container.`);
                         actionContainer.innerHTML = ''; // Remove download button or other actions
                         // Ensure data attribute is removed if no URL is associated with this state
                         if (messageElement.dataset.downloadUrl && !isImage) { // Only revoke if we're not keeping it for an image
                            untrackAndRevokeObjectURL(messageElement.dataset.downloadUrl);
                         }
                         // Remove the attribute only if we are not keeping the URL (e.g., for an image preview)
                         if (!isImage || isFailed || (isComplete && !downloadUrl)) { // Delete if failed, or completed non-image sender, or completed non-image receiver without URL
                            delete messageElement.dataset.downloadUrl;
                         }
                     }
                 } else if (!isComplete || !downloadUrl || !isImage){ // Only warn if action container is expected
                      console.warn(`[UI Update ${transferId}] Action container (.file-action-container) not found (standard update).`);
                 }

                 // Reset container class if we are in the standard update path
                 if (!fileContentElement.classList.contains('image-preview-container')) {
                    fileContentElement.className = 'mt-1 bg-discord-gray-3 p-3 rounded-lg flex items-center file-content';
                 }
            } // End standard update logic else block

            // --- Update data attribute for state tracking (Common for both image and non-image completion) ---
            if (isComplete) {
                // Only set to 'complete' if not already 'delivered'
                if (messageElement.dataset.transferState !== 'delivered') {
                   messageElement.dataset.transferState = 'complete';
                }
                console.log(`[UI Update ${transferId}] Set data-transfer-state to 'complete'.`);
            } else if (isFailed) {
                messageElement.dataset.transferState = 'failed';
                console.log(`[UI Update ${transferId}] Set data-transfer-state to 'failed'.`);
            }
            // --- END Update data attribute ---

        } else {
             console.warn(`[UI Update] Could not find message element for transfer ID: ${transferId} to update progress.`);
        }
    }
}

/**
 * Updates the status of a sent file message to indicate it has been received by the peer.
 * This is called on the sender's side when a 'file_ack' message is received.
 * @param {string} peerId The ID of the peer who sent the acknowledgment (the original receiver).
 * @param {string} transferId The unique ID of the file transfer.
 */
export function updateFileMessageStatusToReceived(peerId, transferId) {
    console.log(`[UI Update ACK] updateFileMessageStatusToReceived called for ack from peer ${peerId}, transfer ${transferId}`);

    const activePeerId = state.getActiveChatPeerId();
    if (peerId !== activePeerId) {
        console.log(`[UI Update ACK] Skipping update for inactive peer ${peerId} (active: ${activePeerId})`);
        return;
    }

    if (dom.messageList && state.localUserId) {
        // Find the message element sent by the local user with the matching transferId
        const messageElement = dom.messageList.querySelector(`.message-item[data-message-id="${transferId}"][data-sender-id="${state.localUserId}"]`);

        if (messageElement) {
            console.log(`[UI Update ACK] Found message element for ${transferId} sent by local user.`);
            const fileContentElement = messageElement.querySelector('.file-content');
            const fileType = fileContentElement?.dataset.fileType || '';
            const isImage = fileType.startsWith('image/');

            // Check if the transfer is already marked as failed or delivered
            const currentState = messageElement.dataset.transferState;
             if (currentState === 'failed') {
                 console.log(`[UI Update ACK ${transferId}] Ignoring ACK update because transfer state is already 'failed'.`);
                 return;
             }
             if (currentState === 'delivered') {
                  console.log(`[UI Update ACK ${transferId}] Ignoring ACK update because transfer state is already 'delivered'.`);
                  return;
             }
             // We should ideally only update from 'complete' to 'delivered'.
             // However, allow update from 'sending' (preview state) directly too.
             if (currentState !== 'complete' && currentState !== 'sending') { // Allow update from sending/complete
                 console.log(`[UI Update ACK ${transferId}] Ignoring ACK update because transfer state is '${currentState}'. Maybe ACK arrived before send completion?`);
                 // Optionally queue this update or handle differently? For now, ignore.
                 return;
             }


            if (fileContentElement) {
                if (isImage) {
                    // --- Update Sender's Image Preview Indicator ---
                    console.log(`[UI Update ACK ${transferId}] Updating sender image preview indicator to 'delivered'.`);
                    // Find the indicator (might be check_circle or schedule_send)
                    const statusIndicator = fileContentElement.querySelector('.sending-indicator, .material-symbols-outlined.text-sm.text-discord-green');
                    if (statusIndicator) {
                        statusIndicator.textContent = 'done_all'; // Double checkmark
                        statusIndicator.classList.remove('text-discord-text-muted');
                        statusIndicator.classList.add('text-discord-green');
                        statusIndicator.title = '已送达';
                        statusIndicator.classList.remove('sending-indicator'); // Remove class if it was there
                    } else {
                        console.warn(`[UI Update ACK ${transferId}] Could not find status indicator in image preview overlay.`);
                    }
                    // Mark state as delivered
                    messageElement.dataset.transferState = 'delivered';
                    console.log(`[UI Update ACK ${transferId}] Set data-transfer-state to 'delivered'.`);

                } else {
                    // --- Update Standard File Info (Non-Image) ---
                    const statusContainer = fileContentElement.querySelector('.flex-1.min-w-0');
                    if (statusContainer) {
                        console.log(`[UI Update ACK ${transferId}] Updating status text to '已送达'.`);
                        const filenameDiv = statusContainer.querySelector('.font-medium.text-discord-text-link');
                        const fileSize = parseInt(fileContentElement.dataset.fileSize || '0', 10);
                        const fileSizeFormatted = formatBytes(fileSize);
                        const newStatusTextHTML = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已送达 <span class="material-symbols-outlined text-xs align-middle text-discord-green">done_all</span></div>`;

                        if (filenameDiv) {
                            while (filenameDiv.nextSibling) {
                                statusContainer.removeChild(filenameDiv.nextSibling);
                            }
                            statusContainer.insertAdjacentHTML('beforeend', newStatusTextHTML);
                            messageElement.dataset.transferState = 'delivered';
                            console.log(`[UI Update ACK ${transferId}] Set data-transfer-state to 'delivered'.`);
                        } else { 
                            console.warn(`[UI Update ACK ${transferId}] Filename div not found within status container (non-image).`);
                         }
                    } else {
                        console.warn(`[UI Update ACK ${transferId}] Status container (.flex-1.min-w-0) not found (non-image).`);
                    }
                }
            } else {
                console.warn(`[UI Update ACK ${transferId}] Could not find .file-content within message element.`);
            }
        } else {
            console.warn(`[UI Update ACK] Could not find sent message element for transfer ID: ${transferId} to update status to received.`);
        }
    } else if (!state.localUserId) {
         console.error("[UI Update ACK] Cannot update file status: localUserId is not set.");
    }
}