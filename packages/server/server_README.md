# ChatBot Server

Backend service for the ChatBot project, responsible for handling chat requests, managing conversation state, and communicating with the AI logic.
The server is built using the Bun runtime for fast startup and efficient request handling.

---

## Tech Stack

- Bun (JavaScript runtime)
- TypeScript
- HTTP API (REST-style)

---

## Project Structure

```
server/
├── index.ts        // Application entry point
├── routes/         // API route definitions (if applicable)
├── services/       // Business logic and integrations
└── package.json
```

---

## Getting Started

### Install dependencies

```bash
bun install
```

### Run the server

```bash
bun run index.ts
```

By default, the server will start on a local port as defined in the code or environment configuration.

---

## API Overview

### POST /api/chat

Handles incoming chat messages from the client.

Request body:

```json
{
  "prompt": "Hello",
  "conversationId": "uuid"
}
```

Response:

```json
{
  "message": "Hi! How can I help you?"
}
```

---

## Design Notes

- Designed to work as a stateless HTTP API
- Conversation continuity is managed using a conversationId
- Easy to extend with additional routes or AI providers

---

## Future Improvements

- Environment-based configuration
- Improved error handling and logging
- Streaming responses
- Authentication and rate limiting

---

## Author

Arel Raba
Computer Science B.Sc – Data Engineering Track
