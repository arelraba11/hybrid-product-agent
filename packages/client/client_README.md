# ChatBot Client (React + TypeScript)

Client-side application for a ChatBot system, built with React, TypeScript, and Vite. This client provides a clean chat interface with keyboard shortcuts, modular components, and clear separation of concerns.

---

## Features

- Real-time chat interface
- Send message with Enter, multiline support with Shift + Enter
- Automatic scroll to the latest message
- Typing indicator while the bot is responding
- Copy only selected message text
- Modular and reusable component architecture
- Form validation and error handling

---

## Tech Stack

- React
- TypeScript
- Vite
- React Hook Form
- Axios
- React Markdown
- Tailwind CSS
- React Icons

---

## Project Structure

```
client/
├── components/
│   ├── ChatInput.tsx        // Chat input form and keyboard handling
│   ├── ChatMessages.tsx     // Messages list, auto-scroll, copy handling
│   ├── TypingIndicator.tsx  // Bot typing indicator
│   └── ui/
│       └── button.tsx
├── pages/
│   └── ChatBot.tsx          // Main chat container
├── services/
│   └── api.ts               // API abstraction (optional)
└── main.tsx
```

---

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

The application will be available at:

```
http://localhost:5173
```

---

## API Integration

The client communicates with the backend using the following endpoint:

```
POST /api/chat
```

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

- Enter is used to send messages for fast interaction
- Shift + Enter allows multiline input
- Components are split by responsibility for maintainability
- Copy behavior is scoped to message content only

---

## Future Improvements

- Message IDs instead of array index keys
- Streaming responses
- Message actions (copy button, retry, delete)
- Dark mode support
- Accessibility improvements

---

## Author

Arel Raba Computer Science B.Sc – Data Engineering Track

