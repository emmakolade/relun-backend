# Relun Backend - TypeScript

A modern TypeScript backend for the Relun dating app with segment-based matching.

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with native driver
- **Real-time**: Socket.IO for WebSocket chat
- **Authentication**: JWT (JSON Web Tokens)
- **Validation**: express-validator

## Features

- ✅ User authentication (email/phone + password)
- ✅ JWT-based authentication with refresh tokens
- ✅ User profiles with photos
- ✅ Swipe functionality (like/pass/super_like)
- ✅ Match system with mutual likes
- ✅ Real-time chat with Socket.IO
- ✅ Segment-based matching (casual/serious/mixed)
- ✅ Location-based features
- ✅ OAuth support (Google, Apple)

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB database
- Redis (for Socket.IO adapter)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
DATABASE_URL="mongodb://localhost:27017/relun_db"
JWT_SECRET=your-secret-key
REDIS_URL=redis://localhost:6379
```

3. Start the development server:
```bash
npm run dev
```

### Development

Run the development server with hot reload:
```bash
npm run dev
```

### Production

Build and run for production:
```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh access token

### Profiles
- `GET /api/profiles/:userId` - Get user profile
- `PUT /api/profiles` - Update own profile
- `POST /api/profiles/photos` - Upload photo
- `DELETE /api/profiles/photos/:photoId` - Delete photo

### Swipes
- `GET /api/swipes/discover` - Get potential matches
- `POST /api/swipes` - Create swipe (like/pass)
- `GET /api/swipes/history` - Get swipe history

### Matches
- `GET /api/matches` - Get all matches
- `GET /api/matches/:matchId` - Get single match
- `DELETE /api/matches/:matchId` - Unmatch

### Chat
- `GET /api/chat/matches/:matchId/messages` - Get messages
- `POST /api/chat/matches/:matchId/messages` - Send message
- `PUT /api/chat/matches/:matchId/messages/read` - Mark as read
- `GET /api/chat/unread` - Get unread count

## WebSocket Events

Connect with authentication token:
```javascript
const socket = io('http://localhost:8000', {
  auth: { token: 'your-jwt-token' }
});
```

### Client -> Server
- `join_match` - Join a match room
- `leave_match` - Leave a match room
- `send_message` - Send a message
- `typing` - Send typing indicator
- `mark_read` - Mark messages as read

### Server -> Client
- `new_message` - Receive new message
- `user_typing` - User typing notification
- `messages_read` - Messages marked as read
- `error` - Error notification

## Database Schema

The database uses MongoDB native driver. Main collections:

- **User** - User accounts and authentication
- **Profile** - Extended user profile information
- **Photo** - User photos
- **Swipe** - Swipe records
- **Match** - Matched users
- **Message** - Chat messages
- **RefreshToken** - JWT refresh tokens

## Project Structure

```
src/
├── config/
│   └── database.ts           # MongoDB connection
├── middleware/
│   └── auth.middleware.ts    # Authentication middleware
├── routes/
│   ├── auth.routes.ts        # Authentication routes
│   ├── profile.routes.ts     # Profile routes
│   ├── swipe.routes.ts       # Swipe routes
│   ├── match.routes.ts       # Match routes
│   └── chat.routes.ts        # Chat routes
├── socket/
│   └── chat.socket.ts        # WebSocket handlers
├── types/
│   └── models.ts             # TypeScript interfaces
├── utils/
│   ├── helpers.ts            # Utility functions
│   └── jwt.utils.ts          # JWT utilities
└── server.ts                 # Main server file
```

## License

ISC
