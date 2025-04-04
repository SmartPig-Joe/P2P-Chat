// ui/contactList.js
import * as dom from '/src/dom.js';
import * as state from '/src/state.js';
import * as connection from '/src/connection.js';
import { escapeHTML } from '/src/utils.js';
import { getAvatarColor } from './main.js'; // Import from ui/main.js
import { showContextMenu } from './contextMenu.js';
import { clearMessageList, addSystemMessage } from './messages.js'; // Needed for request handling, switching chat
import { hideActiveTypingIndicator, updateChatInputVisibility, updateEmptyState, updateChatHeader } from './chatArea.js'; // Needed for switching chat
import { switchToChat } from './main.js'; // Import the new function


// --- NEW Helper for Status Indicator HTML ---
function getStatusIndicatorHTML(status, peerId = null, name = null) {
    let statusIndicatorHTML = '';
    let statusTitle = '';
    const baseClasses = "absolute bottom-0 right-0 block h-3 w-3 rounded-full ring-2 ring-discord-gray-1";
    const nameOrId = name || peerId || '未知用户';
    const idText = peerId ? ` (${escapeHTML(peerId)})` : '';

    if (status === true) {
        statusIndicatorHTML = `<span class="${baseClasses} bg-discord-green" title="${escapeHTML(nameOrId)}${idText} - 在线"></span>`;
        statusTitle = '在线';
    } else if (status === 'connecting') {
        statusIndicatorHTML = `<span class="${baseClasses} bg-discord-yellow" title="${escapeHTML(nameOrId)}${idText} - 连接中..."></span>`;
        statusTitle = '连接中...';
    } else { // false or undefined/null
        statusIndicatorHTML = `<span class="${baseClasses} bg-discord-text-muted opacity-50 group-hover:opacity-100" title="${escapeHTML(nameOrId)}${idText} - 离线"></span>`;
        statusTitle = '离线';
    }
    return { html: statusIndicatorHTML, title: statusTitle };
}
// --- END NEW Helper ---


// Re-renders the entire contact list based on state.contacts and pending requests
export function renderContactList() {
    console.log('[renderContactList] Function called.'); // Add simple log
    console.log(`[renderContactList] Rendering with contacts state:`, JSON.parse(JSON.stringify(state.contacts))); // Deep copy for logging
    if (!dom.contactsListContainer) {
        console.error("[renderContactList] contactsListContainer not found!");
        return;
    }

    dom.contactsListContainer.innerHTML = ''; // Clear existing list

    // Group contacts by friendStatus
    const groups = {
        pending_incoming: [],
        pending_outgoing: [],
        confirmed: [],
        removed_by_peer: [] // Group for those who removed us but are kept in the list
    };

    Object.values(state.contacts).forEach(contact => {
        if (groups[contact.friendStatus]) {
            groups[contact.friendStatus].push(contact);
        } else {
            console.warn(`Contact ${contact.id} has unknown friendStatus: ${contact.friendStatus}`);
            // Optionally group them under a default category or ignore
        }
    });

    let hasAnyContent = false;

    // Render Pending Incoming Requests
    if (groups.pending_incoming.length > 0) {
        hasAnyContent = true;
        const container = document.createElement('div');
        container.id = 'pending-incoming-requests';
        container.innerHTML = `<h3 class="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-discord-text-muted">待处理的请求 - ${groups.pending_incoming.length}</h3>`;
        // Sort? Maybe by timestamp? For now, use default order.
        groups.pending_incoming.forEach(contact => {
            const element = createPendingIncomingElement(contact); // Pass full contact
            container.appendChild(element);
        });
        dom.contactsListContainer.appendChild(container);
    }

    // Render Pending Outgoing Requests
    if (groups.pending_outgoing.length > 0) {
        hasAnyContent = true;
        const container = document.createElement('div');
        container.id = 'pending-outgoing-requests';
        container.innerHTML = `<h3 class="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-discord-text-muted">已发送的请求 - ${groups.pending_outgoing.length}</h3>`;
        // Sort? By name/id?
        groups.pending_outgoing.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        groups.pending_outgoing.forEach(contact => {
            const element = createPendingOutgoingElement(contact); // Pass full contact
            container.appendChild(element);
        });
        dom.contactsListContainer.appendChild(container);
    }

    // Render Confirmed Contacts + Removed by Peer (in the same section for now)
    const mainContacts = [...groups.confirmed, ...groups.removed_by_peer];
    if (mainContacts.length > 0) {
        hasAnyContent = true;
        const container = document.createElement('div');
        container.id = 'confirmed-contacts'; // Keep ID for now, might rename later
        container.innerHTML = `<h3 class="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-discord-text-muted">好友</h3>`;
        // Sort combined list
        mainContacts.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        mainContacts.forEach(contact => {
             // createContactItemElement now handles different statuses internally
             const contactElement = createContactItemElement(contact);
             container.appendChild(contactElement);
             // Highlight if it's the active chat (only if confirmed friend?)
             if (contact.friendStatus === 'confirmed' && contact.id === state.getActiveChatPeerId()) {
                 contactElement.classList.add('bg-discord-gray-4');
                 contactElement.classList.remove('hover:bg-discord-gray-3');
             }
             // Show unread indicator (only if confirmed friend?)
             if (contact.friendStatus === 'confirmed') {
                // showUnreadIndicator(contact.id, contact.hasUnread ?? false);
                // TODO: Re-enable unread indicator logic after checking state.hasUnreadMessages
                console.warn("Unread indicator logic temporarily disabled pending state.hasUnreadMessages check.");
             }
        });
         dom.contactsListContainer.appendChild(container);
    }

    // Handle empty state if nothing is rendered
    if (!hasAnyContent) {
        dom.contactsListContainer.innerHTML = '<p class="text-discord-text-muted text-sm px-3 py-2">还没有联系人或请求。</p>';
    }
}

// Creates a single contact list item element, handles different friend statuses
function createContactItemElement(contact) {
    const element = document.createElement('div');
    // Base classes
    element.className = 'flex items-center space-x-3 px-2 py-1.5 mx-2 rounded group contact-item';
    element.dataset.peerId = contact.id;

    // Status-specific classes and attributes
    let statusIndicatorHTML = '';
    let statusTitle = '状态未知';
    let allowClick = false;
    let showContextMenuFlag = false;
    let specificClasses = '';
    let additionalTitle = ''; // Extra tooltip info

    switch (contact.friendStatus) {
        case 'confirmed':
            element.dataset.contactType = 'confirmed';
            specificClasses = 'hover:bg-discord-gray-3 cursor-pointer confirmed-contact';
            const onlineStatus = contact.online; // true | false | 'connecting'
            const statusResult = getStatusIndicatorHTML(onlineStatus, contact.id, contact.name);
            statusIndicatorHTML = statusResult.html;
            statusTitle = statusResult.title;
            allowClick = true;
            showContextMenuFlag = true;
            break;
        case 'removed_by_peer':
            element.dataset.contactType = 'removed';
            specificClasses = 'opacity-60 cursor-not-allowed removed-contact'; // Make it dimmer, disallow chat click
            // Force offline status indicator visually
            const offlineStatusResult = getStatusIndicatorHTML(false, contact.id, contact.name);
            statusIndicatorHTML = offlineStatusResult.html;
            statusTitle = '离线 (对方已将您移除)';
            additionalTitle = '对方已将您移除。您可以重新发送好友请求。';
            allowClick = false; // Don't allow switching chat
            showContextMenuFlag = true; // Allow right-click to delete? Or re-add? Context menu needs update.
            break;
        // Cases for pending_outgoing/pending_incoming are handled by calling their specific functions now
        // Default case for safety, shouldn't be reached with new renderContactList logic
        default:
             console.warn(`createContactItemElement called with unexpected friendStatus: ${contact.friendStatus} for ${contact.id}`);
             specificClasses = 'opacity-50 cursor-help';
             statusTitle = `未知状态 (${contact.friendStatus})`;
             additionalTitle = `联系人状态未知 (${contact.friendStatus})`;
             const unknownStatusResult = getStatusIndicatorHTML(false, contact.id, contact.name);
             statusIndicatorHTML = unknownStatusResult.html;
             break;
    }

    element.className += ` ${specificClasses}`;
    if (additionalTitle) {
        element.title = additionalTitle;
    }

    const avatarColor = getAvatarColor(contact.id);
    const nameOrId = contact.name || contact.id;
    const avatarText = escapeHTML(nameOrId.charAt(0).toUpperCase());
    const nameEscaped = escapeHTML(nameOrId);
    const idEscaped = escapeHTML(contact.id);

    const unreadIndicatorHTML = (contact.friendStatus === 'confirmed')
        ? '<span class="bg-discord-red w-2 h-2 rounded-full ml-auto hidden unread-indicator"></span>'
        : ''; // Only show unread for confirmed friends

    element.innerHTML = `
        <div class="relative flex-shrink-0">
            <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${nameEscaped} 头像" class="rounded-full" title="${nameEscaped} (${idEscaped}) - ${statusTitle}">
            ${statusIndicatorHTML}
        </div>
        <div class="flex-1 min-w-0">
             <div class="text-discord-text-primary truncate font-medium text-sm contact-name" title="${nameEscaped}">${nameEscaped}</div>
             <div class="text-xs text-discord-text-muted truncate contact-id" title="${idEscaped}">ID: ${idEscaped}</div>
        </div>
        ${unreadIndicatorHTML}
    `;

    if (allowClick) {
        element.addEventListener('click', handleContactClick);
    }
    if (showContextMenuFlag) {
        element.addEventListener('contextmenu', (event) => {
            // TODO: Context menu needs to be updated to handle different friend statuses
            // e.g., offer "Re-add Friend" if status is 'removed_by_peer'
            showContextMenu(event, contact.id, contact.friendStatus); // Pass status to context menu handler
        });
    }

    return element;
}

// Create element for Pending Incoming Request - Accept full contact object
function createPendingIncomingElement(contact) { // Changed parameter
    const element = document.createElement('div');
    element.className = 'flex items-center justify-between px-2 py-1.5 mx-2 rounded group contact-item incoming-request';
    element.dataset.peerId = contact.id;
    element.dataset.contactType = 'incoming';

    const avatarColor = getAvatarColor(contact.id);
    const avatarText = escapeHTML((contact.name || contact.id).charAt(0).toUpperCase());
    const nameEscaped = escapeHTML(contact.name || contact.id);

    element.innerHTML = `
        <div class="flex items-center space-x-3 min-w-0">
            <div class="relative flex-shrink-0">
                <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${nameEscaped} 头像" class="rounded-full" title="${nameEscaped} (${contact.id})">
            </div>
            <span class="flex-1 text-discord-text-primary truncate font-medium text-sm contact-name" title="${nameEscaped} (${contact.id})">${nameEscaped}</span>
        </div>
        <div class="flex items-center space-x-1 flex-shrink-0">
            <button class="accept-request-btn p-1 rounded text-discord-green hover:bg-discord-gray-3" title="接受">
                <span class="material-symbols-outlined text-lg">check</span>
            </button>
            <button class="decline-request-btn p-1 rounded text-discord-red hover:bg-discord-gray-3" title="拒绝">
                <span class="material-symbols-outlined text-lg">close</span>
            </button>
        </div>
    `;

    element.querySelector('.accept-request-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        handleAcceptRequest(contact.id); // Use contact.id
    });
    element.querySelector('.decline-request-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeclineRequest(contact.id); // Use contact.id
    });

    return element;
}

// Create element for Pending Outgoing Request - Accept full contact object
function createPendingOutgoingElement(contact) { // Changed parameter
    console.log('[createPendingOutgoingElement] Function called for contact:', JSON.parse(JSON.stringify(contact))); // Add log here
    const element = document.createElement('div');
    element.className = 'flex items-center justify-between px-2 py-1.5 mx-2 rounded group contact-item outgoing-request opacity-70';
    element.dataset.peerId = contact.id;
    element.dataset.contactType = 'outgoing';

    const avatarColor = getAvatarColor(contact.id);
    const nameEscaped = escapeHTML(contact.name || contact.id); // Use name if available
    const avatarText = escapeHTML(nameEscaped.charAt(0).toUpperCase());

    element.innerHTML = `
        <div class="flex items-center space-x-3 min-w-0">
            <div class="relative flex-shrink-0">
                <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${nameEscaped} 头像" class="rounded-full" title="已发送请求给 ${nameEscaped}">
                 <span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-text-muted ring-2 ring-discord-gray-1 flex items-center justify-center" title="等待确认">
                    <span class="material-symbols-outlined text-[9px] text-discord-gray-1">hourglass_empty</span>
                 </span>
            </div>
            <span class="flex-1 text-discord-text-muted truncate italic font-medium text-sm contact-name" title="等待 ${nameEscaped} 确认">${nameEscaped}</span>
        </div>
        <div class="flex-shrink-0">
             <button class="cancel-request-btn p-1 rounded text-discord-red hover:bg-discord-gray-3 opacity-0 group-hover:opacity-100" title="取消请求">
                 <span class="material-symbols-outlined text-lg">cancel</span>
             </button>
        </div>
    `;

     element.querySelector('.cancel-request-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        handleCancelRequest(contact.id); // Use contact.id
    });

    return element;
}


// --- Handlers for Request Actions ---

async function handleAcceptRequest(peerId) {
    console.log(`[Friend Request] Accepting request from ${peerId}`);
    const contact = state.contacts[peerId]; // Get contact from state
    if (!contact || contact.friendStatus !== 'pending_incoming') {
         console.warn(`Cannot accept request for ${peerId}, status is not pending_incoming.`);
         return;
    }

    const sent = await connection.sendFriendAccept(peerId);
    if (!sent) {
        addSystemMessage(`向 ${contact.name || peerId} 发送接受消息失败。`, null, true);
        return;
    }

    console.log(`[Friend Request] Setting friendStatus to 'confirmed' for ${peerId}`);
    state.setContactFriendStatus(peerId, 'confirmed'); // Set status to confirmed
    state.removePendingIncomingRequest(peerId); // Remove from separate pending set if needed

    // Re-render the whole list to reflect the change
    renderContactList();

    addSystemMessage(`您已接受 ${contact.name || peerId} 的好友请求。`, null);

    // --- MODIFIED: Explicitly update UI status and switch chat ---
    updateContactStatusUI(peerId, 'connecting'); // Assume connecting first
    await switchToChat(peerId); // Switch chat view

    // Attempt connection after accepting (UI is already updated to connecting/switched)
    connection.connectToPeer(peerId)
        .then(dc => {
            // Connection successful (or already existed), ensure UI is fully online
            console.log(`[handleAcceptRequest] connectToPeer successful for ${peerId}. Ensuring UI is online.`);
            updateContactStatusUI(peerId, true);
            updateChatInputVisibility(); // Ensure input is enabled
        })
        .catch(err => {
            console.error(`[handleAcceptRequest] connectToPeer failed for ${peerId}:`, err);
            // UI is already switched, show error and potentially mark offline
            addSystemMessage(`尝试自动连接到 ${contact.name || peerId} 失败: ${err.message}`, peerId, true);
            updateContactStatusUI(peerId, false);
            updateChatInputVisibility(); // Ensure input reflects disconnected state
        });
    // --- END MODIFICATION ---
}

async function handleDeclineRequest(peerId) {
    console.log(`[Friend Request] Declining request from ${peerId}`);
    const contact = state.contacts[peerId];
     if (!contact || contact.friendStatus !== 'pending_incoming') {
         console.warn(`Cannot decline request for ${peerId}, status is not pending_incoming.`);
         return;
    }

    const sent = await connection.sendFriendDecline(peerId); // await added
    if (!sent) {
         addSystemMessage(`向 ${contact.name || peerId} 发送拒绝消息失败（可能已离线）。`, null, true);
         // Proceed with local changes even if send fails
    }

    console.log(`[Friend Request] Removing contact ${peerId} from state after decline.`);
    state.removeContact(peerId); // <-- CHANGE: Remove contact completely
    state.removePendingIncomingRequest(peerId);

    // Re-render the list
    renderContactList();
    addSystemMessage(`您已拒绝 ${contact.name || peerId} 的好友请求。`, null);

    // Disconnect if currently connected (unlikely, but possible)
    if (state.getConnectionState(peerId) === 'connected' || state.getConnectionState(peerId) === 'connecting') {
        connection.disconnectFromPeer(peerId);
    }
}

async function handleCancelRequest(peerId) {
    console.log(`[Friend Request] Cancelling outgoing request to ${peerId}`);
    const contact = state.contacts[peerId];
     if (!contact || contact.friendStatus !== 'pending_outgoing') {
        console.warn(`Cannot cancel request for ${peerId}, status is not pending_outgoing.`);
        return;
    }

    console.log(`[Friend Request] Attempting to send cancellation notification to ${peerId}`);
    const sent = await connection.sendFriendCancel(peerId);
    if (!sent) {
        console.warn(`[Friend Request] Failed to send cancellation notification to ${peerId}. Proceeding with local cancellation.`);
    } else {
        console.log(`[Friend Request] Successfully sent cancellation notification to ${peerId}.`);
    }

    console.log(`[Friend Request] Removing contact ${peerId} from state after cancelling request.`);
    state.removeContact(peerId); // <-- CHANGE: Remove contact completely
    state.removePendingOutgoingRequest(peerId);

    // Re-render the list
    renderContactList();

    addSystemMessage(`您已取消发送给 ${peerId} 的好友请求。`, null);

    // Disconnect if currently connected
    if (state.getConnectionState(peerId) === 'connected' || state.getConnectionState(peerId) === 'connecting') {
        console.log(`[Friend Request] Disconnecting from ${peerId} after cancelling request.`);
        connection.disconnectFromPeer(peerId);
    }
}

// Updates the online status indicator only for confirmed/visible contacts
export function updateContactStatusUI(peerId, status) { // status: boolean | 'connecting'
    if (!dom.contactsListContainer) return;
    // Find element regardless of current friendStatus, but only update confirmed/removed ones
    const contactElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const contactType = contactElement.dataset.contactType;
        const isConfirmed = contactType === 'confirmed';
        const isRemoved = contactType === 'removed';

        // Only update status visually for confirmed friends or removed peers (who should show offline)
        if (isConfirmed || isRemoved) {
            const img = contactElement.querySelector('img');
            const statusIndicatorContainer = contactElement.querySelector('.relative');
            if (!statusIndicatorContainer) return;

            const existingStatusSpan = statusIndicatorContainer.querySelector('span.absolute');
            if (existingStatusSpan) existingStatusSpan.remove();

            const name = contactElement.querySelector('.contact-name')?.textContent || peerId;
            // Use actual status for confirmed, force offline for removed
            const statusToShow = isRemoved ? false : status;
            const { html: statusIndicatorHTML, title: statusTitle } = getStatusIndicatorHTML(statusToShow, peerId, name);

            statusIndicatorContainer.insertAdjacentHTML('beforeend', statusIndicatorHTML);
            if (img) {
                 img.title = `${escapeHTML(name)} (${escapeHTML(peerId)}) - ${statusTitle}`;
            }
            console.log(`Updated UI status for ${peerId} (Type: ${contactType}) to ${statusToShow}`);
        } else {
             console.log(`Skipping UI status update for ${peerId} (Type: ${contactType})`);
        }
    } else {
         // Contact might not be rendered yet, or was just removed. This might not be a warning.
         // console.warn(`Contact element not found for peerId: ${peerId} during status UI update.`);
    }
}

// Shows or hides the unread message indicator for a contact (only for confirmed friends)
export function showUnreadIndicator(peerId, show) {
    if (!dom.contactsListContainer) return;
    const contactElement = dom.contactsListContainer.querySelector(`.contact-item.confirmed-contact[data-peer-id="${peerId}"]`); // Target only confirmed
    if (contactElement) {
        const indicator = contactElement.querySelector('.unread-indicator');
        if (indicator) {
            const shouldBeHidden = !show;
            if (indicator.classList.contains('hidden') !== shouldBeHidden) {
                 indicator.classList.toggle('hidden', shouldBeHidden);
                 console.log(`Set unread indicator for ${peerId} to ${show}`);
            }
        }
    }
}

// Handles clicking on a contact in the list - Now only triggers for allowed types
export async function handleContactClick(event) {
    const targetElement = event.currentTarget;
    const contactType = targetElement.dataset.contactType;

    // --- MODIFIED: Only allow clicks on 'confirmed' contacts ---
    if (contactType !== 'confirmed') {
        console.log(`Clicked on a non-confirmed contact (Type: ${contactType}). Ignoring chat switch.`);
        return;
    }
    // --- END MODIFICATION ---

    const clickedPeerId = targetElement.dataset.peerId;
    const currentActivePeerId = state.getActiveChatPeerId();

    if (!clickedPeerId || clickedPeerId === currentActivePeerId) {
        console.log(`Clicked same peer (${clickedPeerId}) or invalid target.`);
        return;
    }

    console.log(`Confirmed contact clicked: ${clickedPeerId}`);

    // --- NEW: Call the centralized switch function --- 
    await switchToChat(clickedPeerId);
    // --- END NEW ---

    // Check connection status AFTER switching UI
    const connectionStatus = state.getConnectionState(clickedPeerId);
    const needsConnectionAttempt = (connectionStatus !== 'connected' && connectionStatus !== 'connecting');

    // Initiate connection if needed and signaling is up
    if (needsConnectionAttempt) {
        if (!state.isSignalingConnected()) {
            console.warn(`Cannot connect to ${clickedPeerId}: Signaling server disconnected.`);
            addSystemMessage(`暂时无法连接到 ${state.contacts[clickedPeerId]?.name || clickedPeerId}：信令服务器未连接。`, null, true);
        } else {
            console.log(`Contact ${clickedPeerId} is ${connectionStatus}. Attempting to connect...`);
            try {
                connection.connectToPeer(clickedPeerId).catch(err => {
                    console.error(`[handleContactClick] connectToPeer failed for ${clickedPeerId}:`, err);
                    // UI already switched, just show error
                    addSystemMessage(`尝试连接到 ${state.contacts[clickedPeerId]?.name || clickedPeerId} 失败: ${err.message}`, clickedPeerId, true);
                });
            } catch (e) {
                console.error(`Failed to initiate connection via click to ${clickedPeerId}:`, e);
                addSystemMessage(`无法发起与 ${state.contacts[clickedPeerId]?.name || clickedPeerId} 的连接。`, clickedPeerId, true);
            }
        }
    }
}

// Updates the display name and avatar, considers contact type
export function updateContactName(peerId, newName) {
    if (!dom.contactsListContainer) return;
    // Find any contact item with the peer ID
    const contactElement = dom.contactsListContainer.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const nameSpan = contactElement.querySelector('.contact-name');
        const avatarImg = contactElement.querySelector('img');
        const nameEscaped = escapeHTML(newName);

        if (nameSpan) {
            nameSpan.textContent = nameEscaped;
            nameSpan.title = nameEscaped; // Update main name title
        }
        if (avatarImg) {
            const avatarText = escapeHTML(newName.charAt(0).toUpperCase());
            const match = avatarImg.src.match(/\/([0-9a-fA-F]{6})\//);
            const avatarColor = match ? match[1] : getAvatarColor(peerId);
            avatarImg.src = `https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}`;

            // Update avatar title carefully, preserving status part if possible
            const currentTitle = avatarImg.title || '';
            const titleParts = currentTitle.split(' - ');
            const statusPart = titleParts.length > 1 ? titleParts.pop() : '状态未知'; // Get last part (status)
            avatarImg.title = `${nameEscaped} (${peerId}) - ${statusPart}`;
        }
        console.log(`Updated contact name UI for ${peerId} to ${nameEscaped}`);

         // If this contact is the currently active chat, update the chat header too
         if (state.getActiveChatPeerId() === peerId) {
             updateChatHeader(peerId);
         }
    } else {
        console.warn(`Contact element not found for peerId: ${peerId} during name UI update.`);
    }
}

// updateRequestSectionHeaders is no longer needed as renderContactList handles everything
// removeIncomingRequestUI is no longer needed