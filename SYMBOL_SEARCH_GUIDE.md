# Symbol Search & Mapping Guide

## Overview
The AutoTraderHub platform now includes a comprehensive symbol search and mapping system that automatically fetches and synchronizes trading symbols from all supported brokers.

## How to Access Symbol Search

### 1. **In Webhook Syntax Generator**
- Navigate to Dashboard → Webhook Syntax Generator
- You'll see a "Select Trading Symbol" section
- Use the search box to find any stock, future, or option
- The system will show you which brokers support each symbol

### 2. **In Symbols Management Page**
- Navigate to Dashboard → Symbols Management
- Use the symbol search demo to test functionality
- View sync status for all brokers
- Manually trigger symbol synchronization

## Symbol Sources by Broker

### **Zerodha (Kite Connect)**
- **Source**: `https://api.kite.trade/instruments`
- **Format**: CSV file with all NSE, BSE, MCX instruments
- **Authentication**: Not required (public file)
- **Update Frequency**: Daily

### **Upstox**
- **Source**: `https://api.upstox.com/v2/instruments`
- **Format**: JSON response
- **Authentication**: Required (uses your connected account)
- **Update Frequency**: Real-time via API

### **Angel Broking**
- **Source**: `https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json`
- **Format**: JSON file
- **Authentication**: Not required (public file)
- **Update Frequency**: Daily

### **Other Brokers**
- Similar master contract files or API endpoints
- Automatically detected and synchronized

## How Symbol Mapping Works

### **1. Symbol Synchronization**
```javascript
// Backend automatically fetches symbols from all brokers
const symbols = await symbolSyncService.syncAllBrokers();

// Stores in database with mappings:
// - instruments table: Master symbol list
// - broker_instrument_mappings: Broker-specific tokens
```

### **2. Search Functionality**
```javascript
// Frontend searches across all symbols
const results = await symbolsAPI.searchSymbols('RELIANCE', 'NSE', 50);

// Returns:
{
  symbol: 'RELIANCE',
  name: 'Reliance Industries Limited',
  exchange: 'NSE',
  supported_brokers: ['zerodha', 'upstox', 'angel'],
  broker_tokens: ['738561', 'NSE_EQ|INE002A01018', '2885']
}
```

### **3. Automatic Token Conversion**
When you select a symbol, the system automatically:
- Maps the symbol to the correct broker token
- Updates the webhook payload with the right format
- Shows compatibility across brokers

## Using Symbol Search in Practice

### **Step 1: Search for Symbol**
1. Type symbol name (e.g., "RELIANCE", "NIFTY", "BANKNIFTY")
2. System shows matching results with exchange info
3. See which brokers support each symbol

### **Step 2: Select Symbol**
1. Click on desired symbol from dropdown
2. System automatically updates webhook payload
3. Correct broker token is used for selected broker

### **Step 3: Generate Webhook**
1. Symbol is now properly formatted for your broker
2. Webhook payload includes correct instrument token
3. Ready to use in TradingView alerts

## API Endpoints

### **Symbol Search**
```http
GET /api/symbols/search?q=RELIANCE&exchange=NSE&limit=50
```

### **Broker Mapping**
```http
GET /api/symbols/mapping/upstox/RELIANCE/NSE
```

### **Sync Status**
```http
GET /api/symbols/sync-status
```

### **Trigger Sync**
```http
POST /api/symbols/sync-all
POST /api/symbols/sync/zerodha
```

## Database Schema

### **instruments table**
```sql
CREATE TABLE instruments (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT,
  exchange TEXT NOT NULL,
  segment TEXT,
  instrument_type TEXT DEFAULT 'EQ',
  lot_size INTEGER DEFAULT 1,
  tick_size DECIMAL(10,4) DEFAULT 0.05,
  isin TEXT,
  expiry_date DATE,
  strike_price DECIMAL(10,2),
  option_type TEXT
);
```

### **broker_instrument_mappings table**
```sql
CREATE TABLE broker_instrument_mappings (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL,
  broker_name TEXT NOT NULL,
  broker_symbol TEXT NOT NULL,
  broker_token TEXT,
  broker_exchange TEXT,
  is_active BOOLEAN DEFAULT 1
);
```

## Troubleshooting

### **No Search Results**
1. Check if symbols are synchronized: Go to Symbols Management
2. Click "Sync All" to fetch latest symbols
3. Wait for sync to complete (check status)

### **Symbol Not Supported by Broker**
1. Search will show "Not Supported" for incompatible brokers
2. Choose a different broker or symbol
3. Check broker documentation for supported instruments

### **Sync Failures**
1. Check broker connection status
2. Verify API credentials are valid
3. Some brokers require active connection for symbol sync

## Best Practices

### **1. Regular Synchronization**
- Sync symbols weekly or when new instruments are added
- Monitor sync status in Symbols Management page

### **2. Symbol Selection**
- Always use symbol search instead of manual entry
- Verify broker support before creating alerts
- Check exchange and segment match your requirements

### **3. Testing**
- Test webhook with small quantities first
- Verify symbol mapping in paper trading
- Monitor execution logs for any issues

## Example Usage

### **Finding NIFTY Future**
1. Search: "NIFTY"
2. Results show: NIFTY24JAN, NIFTY24FEB, etc.
3. Select appropriate expiry
4. System maps to correct broker token

### **Finding Stock Options**
1. Search: "RELIANCE"
2. Filter by segment: "NFO" 
3. Select strike price and expiry
4. Webhook includes correct option token

### **Cross-Broker Compatibility**
1. Search shows which brokers support each symbol
2. Switch brokers without changing symbol selection
3. System automatically updates token mapping

## Support

For issues with symbol search:
1. Check sync status first
2. Try manual sync for specific broker
3. Verify broker connection is active
4. Contact support with specific symbol and broker details

---

**Note**: Symbol data is updated regularly but may have slight delays. Always verify symbol details before live trading.