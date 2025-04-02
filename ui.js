// ui.js
import * as dom from './dom.js';
import * as state from './state.js';
import { escapeHTML, formatTime, mockUsers, getUserColorClass } from './utils.js';
import * as connection from './connection.js'; // Import connection to call loadAndDisplayHistory
import * as storage from './storage.js'; // Import storage for potential future use (e.g., removing contacts)

let selectedPeerId = null; // Track the currently selected contact in the UI

/**
 * Returns the currently selected peer ID.
 * @returns {string | null}
 */
export function getSelectedPeerId() {
    return selectedPeerId;
}

// --- UI Helper Functions ---

/**
 * Scrolls the message list to the bottom.
 */
export function scrollToBottom() {
    if (dom.messageList) {
        // Use setTimeout to ensure scrolling happens after DOM updates
        setTimeout(() => {
             dom.messageList.scrollTop = dom.messageList.scrollHeight;
        }, 0);
    }
}

/**
 * Clears text, system, and file messages from the message list UI.
 */
export function clearMessageList() {
    if (dom.messageList) {
        dom.messageList.innerHTML = ''; // Clear all messages
        updateEmptyState(); // Update the empty state indicator
    }
}

// --- Empty State ---
export function updateEmptyState() {
    if (!dom.messageList || !dom.emptyMessageListDiv) return;
    // Check if message list has any message items (text or file)
    const hasMessages = dom.messageList.querySelector('.message-item, .file-message-container') !== null;
    const hasSelectedContact = !!selectedPeerId;

    if (hasMessages) {
        dom.emptyMessageListDiv.classList.add('hidden');
    } else if (hasSelectedContact) {
        // No messages, but a contact is selected
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">forum</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">还没有消息</h3>
             <p class="text-sm">看起来这里很安静。开始对话或发送一个文件吧！</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    } else {
        // No contact selected
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">chat</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">选择联系人</h3>
             <p class="text-sm">从左侧选择一个联系人以查看聊天记录。</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    }
}

// --- System Messages ---
export function addSystemMessage(text, isError = false) {
    const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted';
    const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`;
    if (dom.messageList) {
        dom.messageList.insertAdjacentHTML('beforeend', messageHTML);
        scrollToBottom(); // Scroll after adding system message
    }
}

// --- Chat Messages ---
function renderMessageContent(text) {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
    return escapeHTML(text).replace(urlRegex, function(url) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${url}</a>`;
    });
}

function createP2PMessageHTML(msgData) {
    const sender = msgData.isLocal ? (mockUsers.find(u => u.id === state.localUserId) || { name: state.localUserId || '我', avatar: '5865f2' })
                                   : (mockUsers.find(u => u.id === msgData.peerId) || { name: msgData.peerId || '远程用户', avatar: '99aab5' });
    const avatarColor = sender?.avatar || '5865f2';
    const userColorClass = getUserColorClass(sender.name);
    const timeString = formatTime(new Date(msgData.timestamp));
    // Show lock icon if connected to this specific peer and E2EE is active
    const lockIcon = state.sharedKey && state.isConnected && msgData.peerId === state.remoteUserId
                     ? '<span class="material-symbols-outlined text-xs ml-1 text-discord-green align-middle" title="端到端加密">lock</span>'
                     : '';

    return (
       `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded">\
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">\
            <div class="flex-1">\
                <div class="flex items-baseline space-x-2">\
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span>\
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(msgData.timestamp).toLocaleString('zh-CN')}">${timeString}</span>\
                    ${lockIcon}\
                </div>\
                <p class="text-discord-text-primary text-sm message-content">${renderMessageContent(msgData.text)}</p>\
            </div>\
        </div>`
    );
}

export function addP2PMessageToList(msgData) {
    if (dom.messageList && msgData.peerId === selectedPeerId) { // Only add if the message belongs to the selected chat
        const messageElement = document.createElement('div');
        // The HTML structure created by createP2PMessageHTML is the element itself
        messageElement.innerHTML = createP2PMessageHTML(msgData);
        if (messageElement.firstElementChild) {
             dom.messageList.appendChild(messageElement.firstElementChild);
        }
        scrollToBottom();
        updateEmptyState();
    }
    // Removed call to addContactToList - contacts are managed explicitly
}

// --- Typing Indicator ---
export function showTypingIndicator() {
    // Only show if the typing peer is the currently selected AND connected peer
    if (!dom.typingIndicator || !dom.typingUsersSpan || !state.isConnected || state.remoteUserId !== selectedPeerId) return;
    const remoteName = state.contacts[state.remoteUserId]?.name || mockUsers.find(u => u.id === state.remoteUserId)?.name || state.remoteUserId || '对方';
    dom.typingUsersSpan.textContent = escapeHTML(remoteName);
    dom.typingIndicator.classList.remove('hidden');
    dom.typingIndicator.classList.add('flex');
    state.setPeerIsTyping(true);
}

export function hideTypingIndicator() {
    if (!dom.typingIndicator) return;
    dom.typingIndicator.classList.add('hidden');
    dom.typingIndicator.classList.remove('flex');
    state.setPeerIsTyping(false);
}

// --- File Messages ---
function createFileMessageHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    // Determine peerId based on context
    const peerIdForDisplay = fileInfo.peerId || (isLocal ? state.localUserId : (state.remoteUserId || '未知发送者'));
     // Try to get name from contacts first, fallback to mockUsers or ID
    const senderName = isLocal
        ? (state.localUserId || '我')
        : (state.contacts[peerIdForDisplay]?.name || mockUsers.find(u => u.id === peerIdForDisplay)?.name || peerIdForDisplay);

    const sender = isLocal ? { name: senderName, avatar: '5865f2' } // Assuming local user always uses blurple avatar
                           : { name: senderName, avatar: mockUsers.find(u => u.id === peerIdForDisplay)?.avatar || '99aab5' }; // Use mock avatar or default gray

    const avatarColor = sender.avatar; // Use determined avatar color
    const userColorClass = getUserColorClass(sender.name);
    const timeString = formatTime(new Date(fileInfo.timestamp || Date.now()));
    const fileSizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;

    // Material Symbols icon classes
    const fileIconClasses = "material-symbols-outlined text-3xl text-discord-text-muted flex-shrink-0";
    const downloadIconClasses = "material-symbols-outlined text-xl";
    const checkIconClasses = "material-symbols-outlined text-xl text-discord-green";
    const errorIconClasses = "material-symbols-outlined text-xl text-discord-red";
    const progressIconClasses = "material-symbols-outlined text-xl text-discord-blurple animate-spin"; // Spinning icon for progress

    let fileContentHTML;
    const isFailed = progress < 0;
    const isComplete = progress >= 1;

    // Message structure common parts
    const messageHeader = `
        <div class="flex items-baseline space-x-2">
            <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span>
            <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(fileInfo.timestamp || Date.now()).toLocaleString('zh-CN')}">${timeString}</span>
        </div>`;

    let statusText = '';
    let iconHTML = `<span class="${fileIconClasses}">description</span>`; // Default file icon
    let actionHTML = '';

    if (isFailed) {
        statusText = `<div class="text-xs text-discord-red">${fileSizeMB} MB - 传输失败</div>`;
        iconHTML = `<span class="${errorIconClasses} flex-shrink-0">error</span>`;
    } else if (isComplete) {
        if (downloadUrl) { // Receiver completed
            statusText = `<div class="text-xs text-discord-text-muted">${fileSizeMB} MB</div>`;
            actionHTML = `
                <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white ml-auto" title="下载">
                    <span class="${downloadIconClasses}">download</span>
                </a>`;
        } else if (isLocal) { // Sender completed
            statusText = `<div class="text-xs text-discord-text-muted">${fileSizeMB} MB - 已发送</div>`;
            iconHTML = `<span class="${checkIconClasses} flex-shrink-0">check_circle</span>`;
        } else { // Receiver completed (but URL not ready? fallback)
             statusText = `<div class="text-xs text-discord-text-muted">${fileSizeMB} MB - 已接收</div>`;
             iconHTML = `<span class="${checkIconClasses} flex-shrink-0">check_circle</span>`;
        }
    } else { // In progress
        const progressPercent = Math.round(progress * 100);
        statusText = `
            <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - ${isLocal ? '正在发送' : '正在接收'} ${progressPercent}%</div>
            <div class="w-full bg-discord-gray-1 rounded-full h-1 mt-1 overflow-hidden">
                <div class="bg-discord-blurple h-1 rounded-full" style="width: ${progressPercent}%"></div>
            </div>`;
        // Optionally show a progress icon
        // iconHTML = `<span class="${progressIconClasses} flex-shrink-0">autorenew</span>`;
    }

    const fileDetailsHTML = `
        <div class="flex-1 min-w-0">
            <${downloadUrl ? `a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-link hover:underline font-medium block truncate" title="${fileNameEscaped}"` : `span class="text-discord-text-primary font-medium block truncate" title="${fileNameEscaped}"`}>
                ${fileNameEscaped}
            </${downloadUrl ? 'a' : 'span'}>
            ${statusText}
        </div>`;

    fileContentHTML = `
        <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord flex items-center space-x-3">
            ${iconHTML}
            ${fileDetailsHTML}
            ${actionHTML}
        </div>`;

    return (
        `<div class="flex items-start space-x-3 group message-item file-message-container py-1 pr-4 hover:bg-discord-gray-4/30 rounded" data-transfer-id="${transferId}">\
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">\
            <div class="flex-1">\
                ${messageHeader}\
                ${fileContentHTML}\
            </div>\
        </div>`
    );
}

export function addFileMessageToList(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    if (!dom.messageList || !fileInfo || fileInfo.peerId !== selectedPeerId) {
        // If message is not for the currently selected peer, don't add/update visually
        console.log(`[UI] Ignoring file message for ${fileInfo?.peerId} as ${selectedPeerId} is selected.`);
        return;
    }

    const transferId = fileInfo.transferId;
    const existingMsgElement = dom.messageList.querySelector(`.file-message-container[data-transfer-id="${transferId}"]`);

    if (existingMsgElement) {
        // Update existing message
        const newHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl, progress);
        // Create a temporary div to parse the new HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newHTML;
        const newElement = tempDiv.firstElementChild;
        if (newElement) {
            existingMsgElement.replaceWith(newElement);
        }
    } else {
        // Add new message
        const messageHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl, progress);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = messageHTML;
         if (tempDiv.firstElementChild) {
             dom.messageList.appendChild(tempDiv.firstElementChild);
             scrollToBottom(); // Scroll only when adding a new message element
             updateEmptyState();
         }
    }
    // Removed call to addContactToList
}

// --- Member List (Right Sidebar - Review if needed later) ---
export function populateMemberList() {
     if (!dom.onlineListContainer || !dom.offlineListContainer || !dom.onlineCountSpan || !dom.offlineCountSpan) return;

     // Clear existing lists
     dom.onlineListContainer.innerHTML = '';
     dom.offlineListContainer.innerHTML = '';

     let onlineCount = 0;
     let offlineCount = 0;

     const createMemberHTML = (userId, isOnline) => {
         const user = mockUsers.find(u => u.id === userId) || { name: userId, avatar: '99aab5' }; // Fallback
         const avatarColor = user.avatar;
         const statusClass = isOnline ? 'bg-discord-green' : 'bg-gray-500';
         const statusTitle = isOnline ? '在线' : '离线';
         const userColorClass = getUserColorClass(user.name);

         return `
             <div class="flex items-center space-x-2 group">
                 <div class="relative flex-shrink-0">
                     <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${escapeHTML(user.name.charAt(0).toUpperCase())}" alt="${escapeHTML(user.name)} 头像" class="rounded-full" onerror="this.src='https://placehold.co/32x32/2c2f33/ffffff?text=Err'">
                     <span class="absolute bottom-0 right-0 block h-2.5 w-2.5 ${statusClass} border-2 border-discord-gray-2 rounded-full" title="${statusTitle}"></span>
                 </div>
                 <span class="${userColorClass} text-sm truncate group-hover:underline cursor-pointer">${escapeHTML(user.name)}</span>
             </div>`;
     };

     // Always add local user (assume online for now, could be refined)
     dom.onlineListContainer.innerHTML += createMemberHTML(state.localUserId, true);
     onlineCount++;

     // Add remote user if connected
     if (state.isConnected && state.remoteUserId) {
         dom.onlineListContainer.innerHTML += createMemberHTML(state.remoteUserId, true);
         onlineCount++;
     } else if (selectedPeerId && selectedPeerId !== state.remoteUserId) {
         // Show selected peer as offline if not connected
         dom.offlineListContainer.innerHTML += createMemberHTML(selectedPeerId, false);
         offlineCount++;
     }
      // TODO: Maybe populate offline list from state.contacts? For now, keeps it simple.

     dom.onlineCountSpan.textContent = onlineCount;
     dom.offlineCountSpan.textContent = offlineCount;
 }

// --- Contact List (Left Sidebar - NEW/REFACTORED) ---

/**
 * Renders the contact list in the left sidebar based on state.contacts.
 */
export function renderContactList() {
    if (!dom.contactsListContainer) return;

    dom.contactsListContainer.innerHTML = ''; // Clear existing list

    const sortedContacts = Object.values(state.contacts).sort((a, b) => {
        // Optional: Sort contacts (e.g., alphabetically or by status)
        return a.name.localeCompare(b.name);
    });

    if (sortedContacts.length === 0) {
        dom.contactsListContainer.innerHTML = '<p class="text-xs text-discord-text-muted px-2">还没有联系人。使用上面的输入框添加一个吧！</p>';
        return;
    }

    sortedContacts.forEach(contact => {
        const contactElement = createContactItemElement(contact);
        dom.contactsListContainer.appendChild(contactElement);
    });

    // Re-apply active state if a contact is selected
    if (selectedPeerId && state.contacts[selectedPeerId]) {
        const activeElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${selectedPeerId}"]`);
        if (activeElement) {
            activeElement.classList.add('active');
        }
    }
     // Update member list after rendering contacts (optional, depends on desired behavior)
     populateMemberList();
}

/**
 * Creates a single contact item HTML element.
 * @param {object} contact - The contact object { id, name, online }
 * @returns {HTMLElement} - The anchor element for the contact.
 */
function createContactItemElement(contact) {
    const peerId = contact.id;
    const name = contact.name || peerId; // Fallback name to ID
    const isOnline = contact.online;

    // Use mock avatar if available, otherwise generate placeholder
    const user = mockUsers.find(u => u.id === peerId);
    const avatarColor = user?.avatar || '7289da'; // Default Discord blurple
    const avatarText = escapeHTML(name.charAt(0).toUpperCase());

    const element = document.createElement('a');
    element.href = '#'; // Prevent page jump
    element.classList.add('contact-item', 'flex', 'items-center', 'px-2', 'py-1.5', 'text-discord-text-muted', 'hover:bg-discord-gray-4', 'hover:text-discord-text-primary', 'rounded-discord', 'group', 'relative');
    element.dataset.peerId = peerId;

    const statusClass = isOnline ? 'online' : 'offline';
    const statusTitle = isOnline ? '在线' : '离线';

    element.innerHTML = `
        <div class="relative mr-2 flex-shrink-0">
             <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${escapeHTML(name)} 头像" class="rounded-full" onerror="this.src='https://placehold.co/32x32/2c2f33/ffffff?text=Err'">
             <span class="contact-status-indicator ${statusClass} absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full" title="${statusTitle}"></span>
        </div>
        <span class="contact-name truncate flex-1">${escapeHTML(name)}</span>
        <!-- <button class="delete-contact-btn material-symbols-outlined ml-auto text-xs opacity-0 group-hover:opacity-100 text-discord-red hover:text-red-400 p-0.5" title="移除联系人">delete</button> -->
    `;

    // Attach click listener
    element.addEventListener('click', handleContactClick);

    // Code for delete button (commented out for now)
    /*
    const deleteBtn = element.querySelector('.delete-contact-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent contact click
            if (confirm(`确定要移除联系人 ${name} (${peerId}) 吗？`)) {
                // TODO: Implement state.removeContact(peerId)
                console.log(`Request remove contact: ${peerId}`);
            }
        });
    }
    */

    return element;
}

/**
 * Updates the visual status indicator for a specific contact.
 * @param {string} peerId - The ID of the contact to update.
 * @param {boolean} isOnline - The new online status.
 */
export function updateContactStatusUI(peerId, isOnline) {
    if (!dom.contactsListContainer) return;
    const contactElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const indicator = contactElement.querySelector('.contact-status-indicator');
        if (indicator) {
            indicator.classList.remove('online', 'offline');
            indicator.classList.add(isOnline ? 'online' : 'offline');
            indicator.title = isOnline ? '在线' : '离线';
        }
    }
     // Update the member list as well, if it's being used
     populateMemberList();
}

/**
 * Handles clicks on contact items in the list.
 * @param {Event} event - The click event.
 */
export async function handleContactClick(event) {
    event.preventDefault(); // Prevent anchor jump
    const targetElement = event.currentTarget; // The <a> tag
    const peerId = targetElement.dataset.peerId;

    if (!peerId || peerId === selectedPeerId) {
        console.log(`Contact ${peerId} already selected or invalid.`);
        return; // Do nothing if already selected or invalid
    }

    console.log(`[UI] Contact selected: ${peerId}`);
    const previousSelectedId = selectedPeerId;
    selectedPeerId = peerId; // Update selected peer ID

    // --- Update Contact List UI ---
    if (dom.contactsListContainer) {
      // Remove 'active' class from previously selected item
      const previousElement = dom.contactsListContainer.querySelector(`.contact-item.active`);
      if (previousElement) {
          previousElement.classList.remove('active');
      }
      // Add 'active' class to the newly selected item
      targetElement.classList.add('active');
    }

    // --- Update Main Chat Area ---
    if (dom.channelNameH2) {
         const contactName = state.contacts[peerId]?.name || peerId;
         dom.channelNameH2.textContent = escapeHTML(contactName);
         dom.channelNameH2.title = `与 ${escapeHTML(contactName)} (${peerId}) 的聊天`; // Add tooltip with ID
    }

    // Clear existing messages and show loading/empty state
    clearMessageList(); // This also calls updateEmptyState

    // Disable input initially while loading history/connecting
    updateChatInputVisibility(false); // Force hide input initially

     // Show "loading history" or initial empty state
     dom.emptyMessageListDiv.innerHTML = `
         <div class="animate-pulse text-center">
             <span class="material-symbols-outlined text-6xl mb-4 text-discord-text-muted">hourglass_top</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">正在加载聊天记录...</h3>
             <p class="text-sm text-discord-text-muted">请稍候</p>
         </div>
     `;
     dom.emptyMessageListDiv.classList.remove('hidden');


    // --- Load History ---
    try {
        // Disconnect from previous peer ONLY IF we were connected to them
        if (state.isConnected && state.remoteUserId && state.remoteUserId !== peerId) {
             console.log(`[UI] Disconnecting from previous peer ${state.remoteUserId} before connecting to ${peerId}`);
             connection.disconnectFromPeer(); // Disconnect gracefully
             // Wait a moment for disconnection events to potentially process
             await new Promise(resolve => setTimeout(resolve, 100));
        }

        await connection.loadAndDisplayHistory(peerId); // Load history (awaiting ensures it finishes before next steps)
        updateEmptyState(); // Update empty state based on loaded history
    } catch (error) {
        console.error(`Error loading history for ${peerId}:`, error);
        addSystemMessage(`加载 ${peerId} 的聊天记录失败。`, true);
        updateEmptyState(); // Ensure empty state is correct after error
    }

    // --- Initiate Connection ---
    // Only attempt connection if not already connected to this peer
    if (!state.isConnected || state.remoteUserId !== peerId) {
         console.log(`[UI] Attempting connection to selected peer: ${peerId}`);
         try {
             // No await here, connection is asynchronous
             connection.connectToPeer(peerId);
             // Connection status/input visibility will be updated by connection events
         } catch (error) {
             console.error(`[UI] Error initiating connection to ${peerId}:`, error);
             addSystemMessage(`尝试连接到 ${peerId} 时出错。`, true);
             updateChatInputVisibility(); // Update input based on failed attempt
         }
    } else {
         console.log(`[UI] Already connected to ${peerId}. Enabling input.`);
         updateChatInputVisibility(); // Already connected, ensure input is visible
    }

     // Update right sidebar member list
     populateMemberList();
}

// --- Chat Input Area ---

/**
 * Shows or hides the chat input area based on connection status and selected peer.
 * Optionally force visibility state.
 * @param {boolean} [forceVisible=null] - true to force show, false to force hide, null to auto-determine.
 */
export function updateChatInputVisibility(forceVisible = null) {
    if (!dom.chatInputArea) return;

    let shouldBeVisible;
    if (forceVisible !== null) {
        shouldBeVisible = forceVisible;
    } else {
        // Auto-determine: Show only if connected to the *selected* peer
        shouldBeVisible = state.isConnected && state.remoteUserId === selectedPeerId;
    }

    if (shouldBeVisible) {
        dom.chatInputArea.classList.remove('hidden');
        // Optionally focus input when it becomes visible
        // if (dom.messageInput && !dom.messageInput.matches(':focus')) {
        //     dom.messageInput.focus();
        // }
    } else {
        dom.chatInputArea.classList.add('hidden');
    }
    console.log(`[UI] Chat input for ${selectedPeerId} visibility set to: ${shouldBeVisible}`);
}

// --- Local User Info ---
export function displayLocalUserInfo() {
    if (dom.localUserIdSpan) {
        dom.localUserIdSpan.textContent = state.localUserId;
        dom.localUserIdSpan.title = `您的用户 ID: ${state.localUserId}`;
        // Add click-to-copy functionality
        dom.localUserIdSpan.style.cursor = 'pointer';
        dom.localUserIdSpan.onclick = () => {
            navigator.clipboard.writeText(state.localUserId).then(() => {
                const originalText = dom.localUserIdSpan.textContent;
                dom.localUserIdSpan.textContent = '已复制!';
                setTimeout(() => { dom.localUserIdSpan.textContent = originalText; }, 1500);
            }).catch(err => {
                console.error('无法复制 ID: ', err);
                addSystemMessage('无法复制 ID。请手动复制。', true);
            });
        };
    }
    if(dom.localUsernameDiv) {
         const user = mockUsers.find(u => u.id === state.localUserId);
         dom.localUsernameDiv.textContent = user?.name || state.localUserId.substring(0, 8); // Show mock name or truncated ID
         dom.localUsernameDiv.title = state.localUserId; // Full ID on hover
    }
     if(dom.localUserTagDiv) {
         const user = mockUsers.find(u => u.id === state.localUserId);
         dom.localUserTagDiv.textContent = user?.tag || `#${state.localUserId.slice(-4)}`; // Mock tag or last 4 of ID
    }
     if (dom.userAvatarSmall && dom.localUsernameDiv) {
         const user = mockUsers.find(u => u.id === state.localUserId) || { name: state.localUserId, avatar: '5865f2' };
         dom.userAvatarSmall.src = `https://placehold.co/32x32/${user.avatar}/ffffff?text=${escapeHTML(user.name.charAt(0).toUpperCase())}`;
         dom.userAvatarSmall.alt = `${escapeHTML(user.name)} 头像`;
     }
     // Update status indicator (assuming always online for self for now)
     if (dom.userStatusIndicator) {
         dom.userStatusIndicator.classList.remove('bg-gray-500');
         dom.userStatusIndicator.classList.add('bg-discord-green');
         dom.userStatusIndicator.title = '在线';
     }
}

// --- Other UI Updates ---

// Example: Update user profile section (can be expanded)
export function updateUserProfile(userId, profileData) {
    // Find user elements (e.g., in member list or message headers) and update them
    console.log(`[UI] Received request to update profile for ${userId}`, profileData);
    // This would involve finding elements associated with userId and updating names/avatars
    // Potentially re-render contacts list or member list if names changed
    // Example: Update contact list if name changed
    if (state.contacts[userId] && profileData.name && state.contacts[userId].name !== profileData.name) {
         state.contacts[userId].name = profileData.name;
         state.saveContacts(); // Save the name change
         renderContactList(); // Re-render to show new name
    }
     populateMemberList(); // Re-render member list as well
} 