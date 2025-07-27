# AutoTraderHub Information

## Summary
AutoTraderHub is a trading platform that connects TradingView alerts to various broker accounts. It consists of a React frontend and Node.js Express backend. The platform enables automated trading with multi-broker support, real-time order monitoring, and webhook integration for TradingView alerts.

## Structure
- **src/**: React frontend application with TypeScript
- **server/**: Node.js Express backend server
- **server/database/**: SQLite database setup and models
- **server/routes/**: API endpoints for auth, brokers, orders, etc.
- **server/services/**: Business logic for broker integrations
- **server/middleware/**: Express middleware components
- **server/utils/**: Utility functions for logging, encryption, etc.

## Language & Runtime
**Frontend**:
- **Language**: TypeScript/JavaScript with React
- **Version**: TypeScript 5.5.3, React 18.3.1
- **Build System**: Vite 5.4.2
- **Package Manager**: npm

**Backend**:
- **Language**: JavaScript (Node.js)
- **Runtime**: Node.js (ESM modules)
- **Database**: SQLite3 with custom promise wrapper

## Dependencies
**Main Dependencies**:
- **Frontend**: React, React Router, Framer Motion, Recharts, TailwindCSS
- **Backend**: Express, JWT, SQLite3, Winston (logging), Nodemailer, WebSockets
- **Broker APIs**: KiteConnect (Zerodha), custom implementations for other brokers
- **Security**: bcryptjs, crypto-js, helmet, express-rate-limit

**Development Dependencies**:
- ESLint 9.9.1, TypeScript-ESLint
- Vite, PostCSS, TailwindCSS
- Concurrently (for running frontend and backend simultaneously)

## Build & Installation
```bash
# Install dependencies
npm install

# Development mode (runs both frontend and backend)
npm run dev

# Build frontend for production
npm run build

# Start production server
npm start
```

## Database
**Type**: SQLite3
**Schema**: 11 tables including users, broker_connections, orders, positions, holdings
**Path**: ./autotrader.db (configurable via DATABASE_PATH env variable)

## API Endpoints
**Authentication**:
- User registration, login, OTP verification
- Password reset functionality

**Broker Management**:
- Connect/reconnect to multiple brokers
- Get positions and holdings

**Orders**:
- List and manage orders
- Real-time order monitoring

**Webhooks**:
- TradingView webhook integration

## Security Features
- JWT authentication
- AES-256 encryption for sensitive data
- Rate limiting
- CORS protection
- Input validation
- Helmet for HTTP security headers

## Testing
No dedicated testing framework found in the codebase.

## Note
While the README mentions Python and FastAPI, the actual implementation uses Node.js/Express for the backend and React for the frontend. The README appears to be for a different version or planned rewrite of the application.
