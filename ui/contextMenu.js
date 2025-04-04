// ui/contextMenu.js
import * as dom from '../src/dom.js';
import * as state from '../src/state.js';
import * as storage from '../src/storage.js'; // Needed for deleting history/contact
import { escapeHTML } from '../src/utils.js';
import { renderContactList } from './contactList.js'; // Needed after delete
import { clearMessageList, addSystemMessage } from './messages.js'; // Needed after delete/clear history
import { updateChatHeader, updateChatInputVisibility, updateEmptyState, hideActiveTypingIndicator } from './chatArea.js'; // Needed after delete/clear history

// Store the peerId associated with the currently shown context menu
let contextMenuPeerId = null;

/**
 * Shows the custom context menu for a contact item.
 * @param {MouseEvent} event The contextmenu event.
 * @param {string} peerId The ID of the contact.
 */
export function showContextMenu(event, peerId) {
    console.log(`[ContextMenu] Attempting to show for peer: ${peerId}`, event);
    event.preventDefault();
    event.stopPropagation(); // Prevent event from bubbling up and potentially triggering hide listeners prematurely

    // --- IMPORTANT: Hide any currently visible menu and clean up its listeners FIRST ---
    hideContextMenu();
    // --- End Cleanup ---

    // Ensure the target is a confirmed contact in the list container
    const targetElement = dom.contactsListContainer?.querySelector(`.contact-item.confirmed-contact[data-peer-id="${peerId}"]`);
    if (!targetElement) {
         console.log("Context menu attempt on non-confirmed contact or element not found. Ignoring.");
         return;
    }

    contextMenuPeerId = peerId;

    console.log("[ContextMenu] dom.contactContextMenu:", dom.contactContextMenu);
    if (!dom.contactContextMenu) {
        console.error("[ContextMenu] Context menu DOM element not found!");
        return;
    }

    const contacts = state.getContacts(); // USE GETTER
    const contact = contacts[peerId]; // Use getter result
    const name = contact?.name || peerId;

    // Populate the menu
    dom.contactContextMenu.innerHTML = `
        <a href="#" id="delete-contact-action" class="block px-4 py-1.5 text-discord-red hover:bg-discord-gray-3 rounded">
            <span class="material-symbols-outlined text-sm mr-2 align-middle">person_remove</span>删除联系人 "${escapeHTML(name)}"
        </a>
        <a href="#" id="clear-history-action" class="block px-4 py-1.5 text-discord-text-muted hover:bg-discord-gray-3 rounded">
             <span class="material-symbols-outlined text-sm mr-2 align-middle">delete_sweep</span>清空聊天记录
        </a>
        <!-- Add more items here -->
    `;

    // Add event listeners for actions
    const deleteAction = dom.contactContextMenu.querySelector('#delete-contact-action');
    if (deleteAction) {
        deleteAction.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // Stop propagation for action clicks too
            handleDeleteContact(contextMenuPeerId);
            hideContextMenu();
        });
    }

    const clearHistoryAction = dom.contactContextMenu.querySelector('#clear-history-action');
    if (clearHistoryAction) {
         clearHistoryAction.addEventListener('click', (e) => {
             e.preventDefault();
             e.stopPropagation(); // Stop propagation for action clicks too
             handleClearHistory(contextMenuPeerId);
             hideContextMenu();
         });
    }

    // Position and show the menu
    const position = positionContextMenu(event);
    console.log("[ContextMenu] Calculated Position:", position);
     if (position && dom.contactContextMenu) { // Ensure position is valid and element exists
        dom.contactContextMenu.style.top = `${position.top}px`; // Apply position
        dom.contactContextMenu.style.left = `${position.left}px`;
        dom.contactContextMenu.classList.remove('hidden');
        console.log("[ContextMenu] 'hidden' class removed. Current classes:", dom.contactContextMenu.className);

        // Add listeners to hide the menu AFTER showing it and current event processing is likely done
        setTimeout(() => {
             // Double check if the menu we intend to add listeners for is still the active one and visible
             if (dom.contactContextMenu && !dom.contactContextMenu.classList.contains('hidden') && contextMenuPeerId === peerId) {
                  console.log("[ContextMenu] Attaching hide listeners (click, scroll).");
                  window.addEventListener('click', hideContextMenuOnClickOutside, { once: true, capture: true });
                  window.addEventListener('scroll', hideContextMenu, { once: true, capture: true });
             } else {
                   console.log("[ContextMenu] Menu was hidden before listeners could be attached or peerId changed.");
             }
        }, 50); // Use a small delay (50ms)

    } else {
         console.error("[ContextMenu] Failed to calculate position or menu element missing when trying to show.");
    }
}

/**
 * Positions the context menu near the event coordinates, ensuring it stays within bounds.
 * @param {MouseEvent} event
 * @returns {{top: number, left: number} | null} The calculated position or null if menu element is missing.
 */
function positionContextMenu(event) {
    if (!dom.contactContextMenu) return null;

    const menu = dom.contactContextMenu;
    // Temporarily make visible and displayed to measure dimensions
    const hadHiddenClass = menu.classList.contains('hidden'); // Remember if it was hidden
    menu.style.visibility = 'hidden'; // Hide visually
    menu.classList.remove('hidden'); // Remove class to allow display change
    menu.style.display = 'block'; // Set display for measurement

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;

    // IMPORTANT: Reset inline display style and restore original hidden state BEFORE calculating position
    menu.style.display = ''; // Remove the inline style
    if (hadHiddenClass) {
        menu.classList.add('hidden'); // Add class back if it was originally there
    }
    menu.style.visibility = ''; // Remove inline visibility style

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = event.clientY;
    let left = event.clientX;

    // Adjust horizontally
    if (left + menuWidth > viewportWidth - 5) { // Add padding
        left = viewportWidth - menuWidth - 5;
    }
    if (left < 5) {
        left = 5;
    }

    // Adjust vertically
    if (top + menuHeight > viewportHeight - 5) { // Add padding
        top = viewportHeight - menuHeight - 5;
    }
     if (top < 5) {
         top = 5;
     }

    // Return position, styles will be applied in showContextMenu
    return { top, left };
}

/**
 * Hides the custom context menu and cleans up listeners.
 */
export function hideContextMenu() {
    if (dom.contactContextMenu && !dom.contactContextMenu.classList.contains('hidden')) {
        console.log("[ContextMenu] Hiding context menu.");
        dom.contactContextMenu.classList.add('hidden');
        // Remove specific listeners added by showContextMenu
        window.removeEventListener('click', hideContextMenuOnClickOutside, { capture: true });
        window.removeEventListener('scroll', hideContextMenu, { capture: true });
        contextMenuPeerId = null; // Reset peerId only after confirming hide
    }
     // Reset peer ID even if menu was already hidden, just in case state is inconsistent
     contextMenuPeerId = null;
}

/**
 * Event listener callback to hide the context menu if the click is outside it.
 * This should only be attached temporarily by showContextMenu.
 * @param {MouseEvent | Event} event
 */
function hideContextMenuOnClickOutside(event) {
     console.log(`[ContextMenu] hideContextMenuOnClickOutside triggered by ${event.type} on`, event.target);
     // Only react to 'click' events here now
     if (event.type === 'click' && dom.contactContextMenu && !dom.contactContextMenu.classList.contains('hidden')) {
         if (!dom.contactContextMenu.contains(event.target)) {
             console.log("[ContextMenu] Outside click detected, hiding.");
             hideContextMenu();
         } else {
             console.log("[ContextMenu] Inside click detected.");
             // Check if the click was on an action item or just padding
             const clickedAction = (event.target).closest('a');
             if (!clickedAction) {
                  // Clicked inside but not on an action, hide after a small delay
                  setTimeout(() => {
                      if (dom.contactContextMenu && !dom.contactContextMenu.classList.contains('hidden')) {
                           console.log("[ContextMenu] Inside click (not on action) detected after delay, hiding.");
                           hideContextMenu();
                      }
                  }, 50);
             } else {
                  console.log("[ContextMenu] Click on action handled by its own listener.");
                  // Action's own listener will call hideContextMenu
             }
         }
     }
}

/**
 * Handles the deletion of a contact after confirmation.
 * Also deletes associated chat history.
 * @param {string} peerId The ID of the contact to delete.
 */
async function handleDeleteContact(peerId) {
    if (!peerId) return;

    const contacts = state.getContacts(); // USE GETTER
    const contact = contacts[peerId]; // Use getter result
    if (!contact) {
         console.warn(`handleDeleteContact called for non-contact ID: ${peerId}`);
         return;
    }

    const name = contact.name || peerId;

    if (confirm(`您确定要删除联系人 "${escapeHTML(name)}" 吗？\n相关的聊天记录和连接状态将被清除。`)) {
        console.log(`Confirmed deletion for ${peerId}`);

        let historyDeleted = false;
        try {
            // 1. Delete chat history
            await storage.deleteMessagesForPeer(peerId);
            console.log(`Successfully initiated deletion of history for ${peerId}.`);
            historyDeleted = true;

            // 2. Remove contact from state (this also clears peer state like connection)
            const success = state.removeContact(peerId); // This now handles disconnection internally

            if (success) {
                console.log(`Contact ${peerId} removed from state.`);
                renderContactList(); // Re-render list

                // If the deleted contact was the active chat, clear the main panel
                if (state.getActiveChatPeerId() === null) { // Check if removeContact cleared the active chat
                    clearMessageList();
                    hideActiveTypingIndicator();
                    updateChatHeader(null);
                    updateChatInputVisibility(false);
                    updateEmptyState();
                     console.log("Cleared active chat panel as deleted contact was active.");
                }
                addSystemMessage(`联系人 ${escapeHTML(name)} 已删除。`, null);
            } else {
                console.error(`Failed to remove contact ${peerId} from state after history deletion.`);
                 addSystemMessage(`删除联系人 ${escapeHTML(name)} 时出错（未能从状态中移除）。`, null, true);
                 renderContactList(); // Re-render anyway to try and reflect reality
            }

        } catch (error) {
            console.error(`Error during deletion process for ${peerId}:`, error);
            addSystemMessage(`删除联系人 ${escapeHTML(name)} 时发生错误: ${error.message}`, null, true);
            // Re-render list in case of partial failure
            renderContactList();
        }

    } else {
        console.log(`Deletion cancelled for ${peerId}`);
    }
}

/**
 * Handles clearing chat history for a contact.
 * @param {string} peerId
 */
async function handleClearHistory(peerId) {
    if (!peerId) {
        console.warn("handleClearHistory called without peerId.");
        return;
    }

    const contacts = state.getContacts(); // USE GETTER
    const contact = contacts[peerId]; // Use getter result
    const name = contact?.name || peerId;

    if (confirm(`您确定要清空与 "${escapeHTML(name)}" 的本地聊天记录吗？\n此操作不可恢复。`)) {
        console.log(`Confirmed clearing history for ${peerId}`);

        try {
            await storage.deleteMessagesForPeer(peerId);
            console.log(`Successfully initiated deletion of history for ${peerId}.`);

            // If the cleared chat is currently active, update the UI
            if (state.getActiveChatPeerId() === peerId) {
                console.log(`Chat history for active peer ${peerId} cleared. Updating UI.`);
                clearMessageList();
                updateEmptyState();
            }

            addSystemMessage(`与 ${escapeHTML(name)} 的本地聊天记录已清空。`, null);

        } catch (error) {
            console.error(`Error clearing history for ${peerId}:`, error);
            addSystemMessage(`清空 ${escapeHTML(name)} 的聊天记录时出错: ${error.message}`, null, true);
        }
    } else {
        console.log(`Clearing history cancelled for ${peerId}`);
    }
}