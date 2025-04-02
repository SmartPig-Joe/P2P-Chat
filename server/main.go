package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// Message defines the structure for signaling messages
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`        // Use RawMessage for flexible payload handling
	From    string          `json:"from,omitempty"` // Added From field to know the sender
}

// RegisterPayload defines the structure for the 'register' message payload
type RegisterPayload struct {
	UserID string `json:"userId"`
	// RoomID string `json:"roomId,omitempty"` // Optional for room support
}

// ForwardPayload defines the structure needed to extract targetUserId
type ForwardPayload struct {
	TargetUserID string `json:"targetUserId"`
}


// Server manages WebSocket clients and message broadcasting
type Server struct {
	// clients stores the connected clients, mapping userId to the WebSocket connection.
	// Using sync.Map for safe concurrent access.
	clients sync.Map // map[string]*websocket.Conn

	serveMux http.ServeMux
}

// newServer creates a new Server instance
func newServer() *Server {
	s := &Server{}
	s.serveMux.HandleFunc("/ws", s.handleWebSocket)
	return s
}

// handleWebSocket handles incoming WebSocket connections
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	log.Println("WebSocket connection attempt")
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Allow connections from any origin (adjust for production)
		InsecureSkipVerify: true, // Be careful with this in production!
	})
	if err != nil {
		log.Printf("Error accepting websocket: %v", err)
		return
	}
	// Ensure the connection is closed when the function returns
	// Use a variable to track the registered user ID for cleanup
	var registeredUserID string
	defer func() {
		if registeredUserID != "" {
			log.Printf("Client disconnected: %s", registeredUserID)
			s.clients.Delete(registeredUserID)
		} else {
			log.Println("Unregistered client disconnected")
		}
		// Closing the connection explicitly
		err := conn.Close(websocket.StatusNormalClosure, "Connection closed by server")
		if err != nil {
			// Log the error but don't panic, as the client might already be gone
            log.Printf("Error closing websocket connection for %s: %v", registeredUserID, err)
		}

	}()

	log.Println("WebSocket connection established")

	// Set a context for the connection lifetime
	ctx, cancel := context.WithTimeout(r.Context(), time.Hour*24) // Example: 24 hour timeout
    defer cancel()


	// 1. Read the first message, expecting it to be 'register'
	err = s.registerClient(ctx, conn, &registeredUserID)
	if err != nil {
		log.Printf("Failed to register client: %v", err)
		conn.Close(websocket.StatusPolicyViolation, "Registration required")
		return // Stop processing if registration fails
	}
	log.Printf("Client registered: %s", registeredUserID)


	// 2. Enter loop to read subsequent messages
	for {
		msgType, data, err := conn.Read(ctx)
		if err != nil {
			// Check if the error is due to the connection closing normally
			status := websocket.CloseStatus(err)
            if status == websocket.StatusNormalClosure || status == websocket.StatusGoingAway {
                log.Printf("Client %s closed connection normally.", registeredUserID)
            } else if err == context.Canceled || err == context.DeadlineExceeded {
                 log.Printf("Context cancelled or deadline exceeded for %s.", registeredUserID)
            } else {
                log.Printf("Error reading message from %s: %v", registeredUserID, err)
            }
			break // Exit loop on read error
		}

		if msgType != websocket.MessageText {
			log.Printf("Received non-text message type from %s: %v", registeredUserID, msgType)
			continue // Ignore non-text messages
		}

		log.Printf("Received message from %s: %s", registeredUserID, string(data))

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("Error unmarshalling message from %s: %v", registeredUserID, err)
			continue // Ignore malformed messages
		}

		// Inject the sender's ID into the message before forwarding
        msg.From = registeredUserID

		// Handle message based on type (mainly forwarding)
		switch msg.Type {
		case "offer", "answer", "candidate":
            var payload ForwardPayload
            if err := json.Unmarshal(msg.Payload, &payload); err != nil {
                log.Printf("Error unmarshalling target user from %s payload: %v", msg.Type, err)
                continue
            }
			// Re-marshal the message with the 'From' field included
			modifiedData, err := json.Marshal(msg)
			if err != nil {
				log.Printf("Error marshalling modified message: %v", err)
				continue
			}

			log.Printf("Forwarding %s from %s to %s", msg.Type, registeredUserID, payload.TargetUserID)
			s.sendMessageToClient(ctx, payload.TargetUserID, registeredUserID, modifiedData)

        case "register":
             // Should ideally only happen once, log if received again
             log.Printf("Warning: Received 'register' message again from already registered user %s", registeredUserID)

		default:
			log.Printf("Received unhandled message type '%s' from %s", msg.Type, registeredUserID)
		}
	}
}

// registerClient handles reading the initial 'register' message
func (s *Server) registerClient(ctx context.Context, conn *websocket.Conn, userIdStorage *string) error {
    msgType, data, err := conn.Read(ctx)
    if err != nil {
        return err
    }
    if msgType != websocket.MessageText {
        return logErrorf("expected text message for registration")
    }

    var msg Message
    if err := json.Unmarshal(data, &msg); err != nil {
        return logErrorf("error unmarshalling registration message: %v", err)
    }

    if msg.Type != "register" {
        return logErrorf("expected 'register' message type, got '%s'", msg.Type)
    }

    var payload RegisterPayload
    if err := json.Unmarshal(msg.Payload, &payload); err != nil {
        return logErrorf("error unmarshalling register payload: %v", err)
    }

    if payload.UserID == "" {
        return logErrorf("userId cannot be empty in register payload")
    }

	// Store the client connection
	// Check if user ID is already taken (optional, could disconnect old or new)
	if _, loaded := s.clients.LoadOrStore(payload.UserID, conn); loaded {
		log.Printf("User ID %s already connected. Overwriting.", payload.UserID)
		// Optionally close the old connection first if needed
		s.clients.Store(payload.UserID, conn) // Overwrite existing connection
	}

    *userIdStorage = payload.UserID // Store the ID for cleanup in defer
    return nil
}

// sendMessageToClient sends a message to a specific client identified by userId
func (s *Server) sendMessageToClient(ctx context.Context, targetUserId string, originalSenderId string, msgData []byte) {
	if connPtr, ok := s.clients.Load(targetUserId); ok {
		conn := connPtr.(*websocket.Conn) // Type assertion
		err := conn.Write(ctx, websocket.MessageText, msgData)
		if err != nil {
			log.Printf("Error sending message to %s: %v", targetUserId, err)
			// Optionally remove the client if write fails repeatedly
			// s.clients.Delete(targetUserId)
			// conn.Close(...)

			// Notify sender about the failure to send? (Optional)
            // s.sendErrorToClient(ctx, originalSenderId, targetUserId, "Failed to deliver message")

		} else {
            log.Printf("Successfully sent message to %s", targetUserId)
        }
	} else {
		log.Printf("Failed to send message: Client %s not found.", targetUserId)
		// *** Send error message back to the original sender ***
		s.sendErrorToClient(ctx, originalSenderId, targetUserId, "User not found or offline") // Call helper function
	}
}

// sendErrorToClient sends a structured error message to a specific client.
func (s *Server) sendErrorToClient(ctx context.Context, recipientUserId string, relatedUserId string, errorMessage string) {
    errorPayload := map[string]string{
        "message":    errorMessage,
        "targetUser": relatedUserId, // Include the user it failed to reach
    }
    payloadBytes, err := json.Marshal(errorPayload)
    if err != nil {
        log.Printf("Error marshalling error payload for %s: %v", recipientUserId, err)
        return
    }

    errorMsg := Message{
        Type:    "error", // Use 'error' type as expected by client
        Payload: json.RawMessage(payloadBytes),
		// No 'From' needed for server-generated errors, or set to "server"?
    }
    msgBytes, err := json.Marshal(errorMsg)
     if err != nil {
        log.Printf("Error marshalling error message for %s: %v", recipientUserId, err)
        return
    }


    if connPtr, ok := s.clients.Load(recipientUserId); ok {
        conn := connPtr.(*websocket.Conn)
        err := conn.Write(ctx, websocket.MessageText, msgBytes)
        if err != nil {
            log.Printf("Error sending error message to %s: %v", recipientUserId, err)
        } else {
             log.Printf("Sent error '%s' to %s (related to %s)", errorMessage, recipientUserId, relatedUserId)
        }
    } else {
         // If the original sender is also gone, just log it.
         log.Printf("Could not send error back to original sender %s as they are no longer connected.", recipientUserId)
    }
}

// Helper for logging errors before returning them
func logErrorf(format string, v ...interface{}) error {
    log.Printf(format, v...)
    // You might want to return a more structured error here in a real app
    return &websocket.CloseError{Code: websocket.StatusPolicyViolation, Reason: "Invalid message format or content"}
}


func main() {
	log.Println("Starting signaling server...")
	server := newServer()

	// **IMPORTANT**: Change "localhost:8080" to the desired host and port.
	// Use ":8080" to listen on all network interfaces on port 8080.
	// Use "0.0.0.0:8080" explicitly for the same effect on some systems.
	listenAddr := ":8080"
	log.Printf("Listening on %s", listenAddr)

	err := http.ListenAndServe(listenAddr, &server.serveMux)
	if err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
