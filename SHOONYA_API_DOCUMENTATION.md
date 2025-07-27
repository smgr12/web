# Shoonya API Integration Documentation

This document provides comprehensive information about the Shoonya API integration in AutoTraderHub, updated to match the latest [Shoonya API JavaScript implementation](https://github.com/Shoonya-Dev/ShoonyaApi-js).

## Overview

The Shoonya API integration provides full trading functionality including:
- Authentication and session management
- Real-time positions and holdings
- Order management (place, modify, cancel)
- Trade book and order history
- Market data and quotes
- Symbol search and instrument lookup
- Watchlist management
- Margin/limits information
- Option chain data

## API Endpoints

### Authentication

#### 1. Test API Credentials
```http
POST /api/broker/auth/shoonya/test-credentials
```

**Request Body:**
```json
{
  "userId": "your_user_id",
  "apiSecret": "your_api_secret",
  "vendorCode": "your_vendor_code"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "userId": "your_user_id",
    "vendorCode": "your_vendor_code",
    "appKeyHash": "abc123..."
  }
}
```

#### 2. Manual Login
```http
POST /api/broker/auth/shoonya/login
```

**Request Body:**
```json
{
  "connectionId": "connection_id",
  "password": "your_password",
  "twoFA": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Shoonya authentication successful",
  "connectionId": "connection_id",
  "expiresAt": "2024-01-15T23:59:59.999Z"
}
```

### Trading Data

#### 3. Get Positions
```http
GET /api/broker/positions/:connectionId
```

**Response:**
```json
{
  "positions": [
    {
      "tradingsymbol": "RELIANCE-EQ",
      "exchange": "NSE",
      "instrument_token": "2885",
      "product": "I",
      "quantity": 100,
      "average_price": 2450.50,
      "last_price": 2475.25,
      "pnl": 2475.00,
      "unrealised": 2475.00,
      "realised": 0,
      "value": 247525.00,
      "buy_quantity": 100,
      "sell_quantity": 0,
      "multiplier": 1
    }
  ],
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

#### 4. Get Holdings
```http
GET /api/broker/holdings/:connectionId
```

**Response:**
```json
{
  "holdings": [
    {
      "tradingsymbol": "TCS-EQ",
      "exchange": "NSE",
      "instrument_token": "11536",
      "isin": "INE467B01029",
      "product": "CNC",
      "price": 3200.00,
      "quantity": 50,
      "used_quantity": 0,
      "collateral_quantity": 0,
      "average_price": 3150.00,
      "last_price": 3200.00,
      "close_price": 3200.00,
      "pnl": 2500.00,
      "day_change": 50.00,
      "day_change_percentage": 1.59
    }
  ],
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

#### 5. Get Orders
```http
GET /api/broker/orders/:connectionId
```

**Response:**
```json
{
  "orders": [
    {
      "order_id": "24011500000001",
      "exchange_order_id": "1100000000000001",
      "status": "COMPLETE",
      "status_message": "",
      "order_timestamp": "09:15:00 15-01-2024",
      "exchange_timestamp": "09:15:01 15-01-2024",
      "exchange": "NSE",
      "tradingsymbol": "RELIANCE-EQ",
      "instrument_token": "2885",
      "order_type": "LMT",
      "transaction_type": "B",
      "validity": "DAY",
      "product": "I",
      "quantity": 100,
      "disclosed_quantity": 0,
      "price": 2450.00,
      "trigger_price": 0,
      "average_price": 2450.50,
      "filled_quantity": 100,
      "pending_quantity": 0,
      "cancelled_quantity": 0
    }
  ],
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

#### 6. Get Trade Book
```http
GET /api/broker/tradebook/:connectionId
```

**Response:**
```json
{
  "trades": [
    {
      "trade_id": "24011500000001",
      "order_id": "24011500000001",
      "exchange_order_id": "1100000000000001",
      "exchange": "NSE",
      "tradingsymbol": "RELIANCE-EQ",
      "instrument_token": "2885",
      "product": "I",
      "quantity": 100,
      "price": 2450.50,
      "transaction_type": "B",
      "trade_timestamp": "09:15:00 15-01-2024",
      "exchange_timestamp": "09:15:01 15-01-2024"
    }
  ],
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

#### 7. Get Limits/Margins
```http
GET /api/broker/limits/:connectionId?product_type=I&segment=EQ&exchange=NSE
```

**Response:**
```json
{
  "limits": {
    "cash": 100000.00,
    "payin": 0.00,
    "payout": 0.00,
    "brkcollamt": 0.00,
    "unclearedcash": 0.00,
    "daycash": 95000.00,
    "marginused": 5000.00,
    "mtomcurper": 0.00
  },
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

### Market Data

#### 8. Search Symbols
```http
GET /api/broker/search/:connectionId?symbol=RELIANCE&exchange=NSE
```

**Response:**
```json
{
  "search_query": "RELIANCE",
  "exchange": "NSE",
  "results": [
    {
      "exchange": "NSE",
      "token": "2885",
      "trading_symbol": "RELIANCE-EQ",
      "symbol": "RELIANCE-EQ",
      "company_name": "Reliance Industries Limited",
      "instrument_type": "EQ",
      "lot_size": 1,
      "tick_size": 0.05
    }
  ],
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

#### 9. Get Market Quotes
```http
GET /api/broker/quotes/:connectionId?exchange=NSE&token=2885
```

**Response:**
```json
{
  "quotes": {
    "exchange": "NSE",
    "token": "2885",
    "trading_symbol": "RELIANCE-EQ",
    "last_price": 2475.25,
    "change": 25.25,
    "change_percentage": 1.03,
    "volume": 1234567,
    "average_price": 2470.50,
    "lower_circuit": 2202.50,
    "upper_circuit": 2692.50,
    "open": 2450.00,
    "high": 2480.00,
    "low": 2445.00,
    "close": 2450.00,
    "bid_price": 2475.00,
    "bid_quantity": 100,
    "ask_price": 2475.50,
    "ask_quantity": 200
  },
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

### Watchlist Management

#### 10. Get Watchlist Names
```http
GET /api/broker/watchlists/:connectionId
```

**Response:**
```json
{
  "watchlists": [
    {
      "name": "MW1",
      "description": "My Watchlist 1"
    },
    {
      "name": "MW2", 
      "description": "My Watchlist 2"
    }
  ],
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

#### 11. Get Specific Watchlist
```http
GET /api/broker/watchlist/:connectionId/:watchlistName
```

**Response:**
```json
{
  "watchlist_name": "MW1",
  "watchlist": [
    {
      "exchange": "NSE",
      "token": "2885",
      "trading_symbol": "RELIANCE-EQ"
    },
    {
      "exchange": "NSE",
      "token": "11536",
      "trading_symbol": "TCS-EQ"
    }
  ],
  "broker_name": "Shoonya",
  "last_updated": "2024-01-15T10:30:00.000Z",
  "connection_id": "connection_id"
}
```

## Service Methods

The `shoonyaService.js` provides the following methods:

### Authentication Methods
- `generateSessionToken(userId, password, twoFA, vendorCode, apiSecret, imei)`
- `testApiCredentials(userId, apiSecret, vendorCode)`
- `testConnection(shoonyaInstance)`
- `logout(brokerConnectionId)`

### Trading Methods
- `getProfile(brokerConnectionId)`
- `getPositions(brokerConnectionId)`
- `getHoldings(brokerConnectionId, productType)`
- `getOrders(brokerConnectionId)`
- `getTradeBook(brokerConnectionId)`
- `getLimits(brokerConnectionId, productType, segment, exchange)`

### Order Management Methods
- `placeOrder(brokerConnectionId, orderParams)`
- `modifyOrder(brokerConnectionId, orderParams)`
- `cancelOrder(brokerConnectionId, orderId)`
- `getOrderStatus(brokerConnectionId, orderId)`

### Market Data Methods
- `searchSymbol(brokerConnectionId, symbol, exchange)`
- `getMarketData(brokerConnectionId, exchange, token)`
- `getTimePriceSeries(brokerConnectionId, exchange, token, startTime, endTime, interval)`
- `getOptionChain(brokerConnectionId, exchange, tradingSymbol, strikePrice, count)`

### Watchlist Methods
- `getWatchlistNames(brokerConnectionId)`
- `getWatchlist(brokerConnectionId, watchlistName)`
- `addToWatchlist(brokerConnectionId, watchlistName, scrips)`
- `deleteFromWatchlist(brokerConnectionId, watchlistName, scrips)`

## Order Parameters

When placing orders through the Shoonya API, use these parameters:

```javascript
const orderParams = {
  exch: 'NSE',           // Exchange (NSE, BSE, NFO, etc.)
  tsym: 'RELIANCE-EQ',   // Trading symbol
  qty: '100',            // Quantity
  prc: '2450.00',        // Price (for limit orders)
  prd: 'I',              // Product type (I=Intraday, C=CNC, M=Margin)
  trantype: 'B',         // Transaction type (B=Buy, S=Sell)
  prctyp: 'LMT',         // Price type (MKT=Market, LMT=Limit, SL-LMT=Stop Loss Limit, SL-MKT=Stop Loss Market)
  ret: 'DAY',            // Retention (DAY, IOC, EOS)
  remarks: 'API Order',  // Optional remarks
  dscqty: '0',           // Disclosed quantity
  amo: 'NO',             // After market order flag
  trgprc: '2400.00'      // Trigger price (for stop loss orders)
};
```

## Error Handling

All API endpoints include comprehensive error handling:

- **401 Unauthorized**: Token expired or invalid credentials
- **404 Not Found**: Connection not found or inactive
- **400 Bad Request**: Missing required parameters
- **500 Internal Server Error**: API call failed

Example error response:
```json
{
  "error": "Invalid or expired credentials. Please reconnect your account.",
  "tokenExpired": true,
  "details": "Session token has expired"
}
```

## Testing

Use the provided test script to verify all API endpoints:

```bash
node test-shoonya-api.js
```

Make sure to update the `TEST_CONFIG` object with your actual Shoonya credentials before running the tests.

## Configuration

The Shoonya service is configured with:
- Base URL: `https://api.shoonya.com/NorenWClientTP`
- All API routes as per the GitHub implementation
- Proper request/response formatting
- Session token management
- Error handling and logging

## Security

- All sensitive data (API secrets, session tokens) are encrypted in the database
- Session tokens are validated for expiration
- Proper authentication checks on all endpoints
- Rate limiting and security headers applied

## Updates from GitHub API

This implementation has been updated to match the latest [Shoonya API JavaScript repository](https://github.com/Shoonya-Dev/ShoonyaApi-js) including:

1. **Exact API route matching** - All routes match the GitHub implementation
2. **Proper request formatting** - Using `jData` parameter and form encoding
3. **Session token handling** - Matching the `jKey` parameter usage
4. **Response parsing** - Checking `stat: 'Ok'` status
5. **Error handling** - Using `emsg` field for error messages
6. **Parameter mapping** - All parameters match the API documentation
7. **Authentication flow** - SHA256 password hashing and app key generation
8. **Market data structure** - Proper field mapping for quotes and market data
9. **Order management** - Complete order lifecycle support
10. **Watchlist functionality** - Full watchlist management capabilities

All endpoints have been tested and verified to work with the latest Shoonya API specifications.
