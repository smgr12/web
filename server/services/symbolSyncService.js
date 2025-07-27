import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
// import cron from 'node-cron'; // Disabled - manual sync only
import { db } from '../database/init.js';
import { createLogger } from '../utils/logger.js';
import { decryptData } from '../utils/encryption.js';

const logger = createLogger('SymbolSyncService');

class SymbolSyncService {
  constructor() {
    this.syncInProgress = new Set(); // Track ongoing sync operations
    this.dataDir = path.join(process.cwd(), 'data', 'symbols');
    this.lastSyncDate = new Map(); // Track last sync date for each broker
    this.instrumentCache = new Map(); // Cache instrument data
    this.initializeDataDirectory();
    this.initializeDefaultSyncStatus();
    // this.scheduleDailySync(); // Disabled - manual sync only
  }

  // Initialize data directory for storing symbol files
  async initializeDataDirectory() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      logger.info('Symbol data directory initialized:', this.dataDir);
    } catch (error) {
      logger.error('Failed to create symbol data directory:', error);
    }
  }

  // Initialize default sync status for all brokers
  async initializeDefaultSyncStatus() {
    try {
      const brokers = ['zerodha', 'upstox', 'angel', 'shoonya'];
      
      for (const broker of brokers) {
        // Check if status already exists
        const existing = await db.getAsync(
          'SELECT id FROM symbol_sync_status WHERE broker_name = ?',
          [broker]
        );
        
        if (!existing) {
          await db.runAsync(`
            INSERT INTO symbol_sync_status (
              broker_name, sync_status, total_symbols, created_at, updated_at
            ) VALUES (?, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `, [broker]);
          
          logger.info(`Initialized default sync status for ${broker}`);
        }
      }
    } catch (error) {
      logger.error('Failed to initialize default sync status:', error);
    }
  }

  // Schedule daily sync at 6 AM IST
  scheduleDailySync() {
    // Run daily at 6:00 AM IST (00:30 UTC)
    cron.schedule('30 0 * * *', async () => {
      logger.info('Starting scheduled daily symbol sync');
      try {
        await this.syncAllBrokers();
        logger.info('Scheduled daily symbol sync completed successfully');
      } catch (error) {
        logger.error('Scheduled daily symbol sync failed:', error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });
    
    logger.info('Daily symbol sync scheduled for 6:00 AM IST');
  }

  // Check if sync is needed (once per day)
  async isSyncNeeded(brokerName) {
    const today = new Date().toDateString();
    const lastSync = this.lastSyncDate.get(brokerName);
    
    if (!lastSync || lastSync !== today) {
      return true;
    }
    
    // Also check database for last sync
    try {
      const syncStatus = await db.getAsync(
        'SELECT last_sync_at FROM symbol_sync_status WHERE broker_name = ?',
        [brokerName]
      );
      
      if (!syncStatus || !syncStatus.last_sync_at) {
        return true;
      }
      
      const lastSyncDate = new Date(syncStatus.last_sync_at);
      const todayDate = new Date();
      
      // Check if last sync was today
      return lastSyncDate.toDateString() !== todayDate.toDateString();
    } catch (error) {
      logger.error('Error checking sync status:', error);
      return true; // Sync if we can't determine status
    }
  }

  // Main method to sync symbols for all brokers
  async syncAllBrokers() {
    try {
      logger.info('Starting symbol sync for all brokers');
      
      const brokers = ['zerodha', 'upstox', 'angel', 'shoonya'];
      const results = {};
      
      for (const broker of brokers) {
        // Check if sync is needed for this broker
        const needsSync = await this.isSyncNeeded(broker);
        if (!needsSync) {
          logger.info(`Skipping ${broker} - already synced today`);
          results[broker] = { success: true, skipped: true, reason: 'Already synced today' };
          continue;
        }
        
        try {
          results[broker] = await this.syncBrokerSymbols(broker);
          // Mark as synced today
          this.lastSyncDate.set(broker, new Date().toDateString());
        } catch (error) {
          logger.error(`Failed to sync symbols for ${broker}:`, error);
          results[broker] = { success: false, error: error.message };
        }
      }
      
      logger.info('Symbol sync completed for all brokers', results);
      return results;
    } catch (error) {
      logger.error('Failed to sync symbols for all brokers:', error);
      throw error;
    }
  }

  // Sync symbols for a specific broker
  async syncBrokerSymbols(brokerName) {
    const normalizedBrokerName = brokerName.toLowerCase();
    
    if (this.syncInProgress.has(normalizedBrokerName)) {
      throw new Error(`Sync already in progress for ${brokerName}`);
    }

    this.syncInProgress.add(normalizedBrokerName);
    
    try {
      logger.info(`Starting symbol sync for ${brokerName}`);
      
      // Update sync status to 'in_progress'
      await this.updateSyncStatus(normalizedBrokerName, 'in_progress', null, 0);
      
      let symbols = [];
      
      switch (normalizedBrokerName) {
        case 'zerodha':
          symbols = await this.fetchZerodhaSymbols();
          break;
        case 'upstox':
          symbols = await this.fetchUpstoxSymbols();
          break;
        case 'angel':
          symbols = await this.fetchAngelSymbols();
          break;
        case 'shoonya':
          symbols = await this.fetchShoonyaSymbols();
          break;
        default:
          throw new Error(`Unsupported broker: ${brokerName}`);
      }
      
      if (!symbols || symbols.length === 0) {
        throw new Error(`No symbols fetched for ${brokerName}`);
      }
      
      logger.info(`Fetched ${symbols.length} symbols for ${brokerName}, now storing...`);
      
      // Store symbols in database and files
      const result = await this.storeSymbols(normalizedBrokerName, symbols);
      
      logger.info(`Stored symbols for ${brokerName}`, result);
      
      // Save to files (non-critical, don't fail sync if this fails)
      try {
        await this.saveSymbolsToFile(normalizedBrokerName, symbols);
        logger.info(`Saved symbols to files for ${brokerName}`);
      } catch (fileError) {
        logger.warn(`Failed to save symbols to files for ${brokerName}:`, fileError.message);
        // Don't fail the sync for file save errors
      }
      
      // Update sync status to 'completed'
      await this.updateSyncStatus(normalizedBrokerName, 'completed', null, symbols.length);
      
      logger.info(`Symbol sync completed successfully for ${brokerName}`, {
        totalSymbols: symbols.length,
        stored: result.stored,
        updated: result.updated
      });
      
      return {
        success: true,
        totalSymbols: symbols.length,
        stored: result.stored,
        updated: result.updated
      };
      
    } catch (error) {
      logger.error(`Symbol sync failed for ${brokerName}:`, error);
      
      try {
        await this.updateSyncStatus(normalizedBrokerName, 'failed', error.message, 0);
      } catch (statusError) {
        logger.error(`Failed to update status for ${brokerName}:`, statusError);
      }
      
      throw error;
    } finally {
      this.syncInProgress.delete(normalizedBrokerName);
    }
  }

  // Fetch symbols from Zerodha (public instruments file)
  async fetchZerodhaSymbols() {
    try {
      logger.info('Fetching Zerodha symbols from public instruments file');
      
      const response = await axios.get('https://api.kite.trade/instruments', {
        timeout: 60000 // 60 seconds timeout
      });
      
      const csvData = response.data;
      const lines = csvData.split('\n');
      const headers = lines[0].split(',');
      
      const symbols = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = line.split(',');
        if (values.length >= headers.length) {
          const instrument = {};
          headers.forEach((header, index) => {
            instrument[header.trim()] = values[index]?.trim() || '';
          });
          
          // Enhanced symbol mapping with all required fields
          symbols.push({
            symbol: instrument.tradingsymbol,
            name: instrument.name,
            exchange: instrument.exchange,
            segment: instrument.segment,
            instrument_type: instrument.instrument_type,
            lot_size: parseInt(instrument.lot_size) || 1,
            tick_size: parseFloat(instrument.tick_size) || 0.05,
            expiry: instrument.expiry || null,
            strike: parseFloat(instrument.strike) || null,
            option_type: instrument.option_type || null,
            broker_token: instrument.instrument_token,
            broker_exchange: instrument.exchange,
            broker_symbol: instrument.tradingsymbol,
            // Additional Zerodha specific fields
            isin: instrument.isin || null,
            last_price: parseFloat(instrument.last_price) || null,
            multiplier: parseFloat(instrument.multiplier) || 1,
            // Webhook format fields
            tradingsymbol: instrument.tradingsymbol,
            instrument_token: instrument.instrument_token
          });
        }
      }
      
      logger.info(`Fetched ${symbols.length} symbols from Zerodha`);
      return symbols;
      
    } catch (error) {
      logger.error('Failed to fetch Zerodha symbols:', error);
      throw new Error(`Zerodha symbol fetch failed: ${error.message}`);
    }
  }

  // Fetch symbols from Upstox using public instruments API
  async fetchUpstoxSymbols() {
    try {
      logger.info('Fetching Upstox symbols from public instruments API');
      
      // Try multiple Upstox endpoints
      let response;
      let symbols = [];
      
      // Try the main CSV endpoint first
      try {
        logger.info('Trying Upstox complete CSV endpoint...');
        response = await axios.get('https://assets.upstox.com/market-quote/instruments/exchange/complete.csv', {
          timeout: 120000, // 2 minutes timeout
          responseType: 'text'
        });
        
        if (response.data && response.data.length > 1000) {
          logger.info('Successfully fetched Upstox CSV data, size:', response.data.length);
        } else {
          throw new Error('CSV data too small or empty');
        }
      } catch (csvError) {
        logger.warn('Complete CSV failed, trying individual exchange files:', csvError.message);
        
        // Try individual exchange files
        const exchanges = [
          'https://assets.upstox.com/market-quote/instruments/exchange/NSE_EQ.csv',
          'https://assets.upstox.com/market-quote/instruments/exchange/NSE_FO.csv',
          'https://assets.upstox.com/market-quote/instruments/exchange/BSE_EQ.csv',
          'https://assets.upstox.com/market-quote/instruments/exchange/BSE_FO.csv',
          'https://assets.upstox.com/market-quote/instruments/exchange/MCX_FO.csv'
        ];
        
        let combinedData = '';
        let headerAdded = false;
        
        for (const exchangeUrl of exchanges) {
          try {
            logger.info(`Fetching from ${exchangeUrl}...`);
            const exchangeResponse = await axios.get(exchangeUrl, {
              timeout: 60000,
              responseType: 'text'
            });
            
            if (exchangeResponse.data) {
              const lines = exchangeResponse.data.split('\n');
              if (!headerAdded && lines.length > 0) {
                combinedData += lines[0] + '\n'; // Add header
                headerAdded = true;
              }
              // Add data lines (skip header)
              for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim()) {
                  combinedData += lines[i] + '\n';
                }
              }
              logger.info(`Added ${lines.length - 1} lines from ${exchangeUrl}`);
            }
          } catch (exchangeError) {
            logger.warn(`Failed to fetch ${exchangeUrl}:`, exchangeError.message);
          }
        }
        
        if (combinedData.length > 1000) {
          response = { data: combinedData };
          logger.info('Successfully combined exchange data, total size:', combinedData.length);
        } else {
          throw new Error('All Upstox endpoints failed or returned insufficient data');
        }
      }
      
      // Parse CSV data
      if (typeof response.data === 'string') {
        const lines = response.data.split('\n');
        if (lines.length < 2) {
          throw new Error('Invalid CSV format - insufficient data');
        }
        
        const headers = lines[0].split(',').map(h => h.trim());
        logger.info('CSV headers:', headers.slice(0, 10)); // Log first 10 headers
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Handle CSV parsing with quoted values
          const values = this.parseCSVLine(line);
          if (values.length >= headers.length - 2) { // Allow some flexibility
            const instrument = {};
            headers.forEach((header, index) => {
              instrument[header] = values[index]?.trim() || '';
            });
            
            // Map Upstox fields to our standard format
            const symbol = {
              symbol: instrument.trading_symbol || instrument.symbol || instrument.tradingsymbol,
              name: instrument.name || instrument.company_name || instrument.companyname,
              exchange: instrument.exchange,
              segment: instrument.segment,
              instrument_type: instrument.instrument_type || instrument.instrumenttype,
              lot_size: parseInt(instrument.lot_size || instrument.lotsize) || 1,
              tick_size: parseFloat(instrument.tick_size || instrument.ticksize) || 0.05,
              expiry: instrument.expiry || instrument.expiry_date || null,
              strike: parseFloat(instrument.strike_price || instrument.strike) || null,
              option_type: instrument.option_type || instrument.optiontype || null,
              broker_token: instrument.instrument_key || instrument.token || instrument.instrument_token,
              broker_exchange: instrument.exchange,
              broker_symbol: instrument.trading_symbol || instrument.symbol,
              // Additional Upstox specific fields
              isin: instrument.isin || null,
              weekly_expiry: instrument.weekly_expiry || null,
              // Webhook format fields
              instrument_token: instrument.instrument_key || instrument.token,
              trading_symbol: instrument.trading_symbol || instrument.symbol
            };
            
            // Only add if we have essential fields
            if (symbol.symbol && symbol.exchange) {
              symbols.push(symbol);
            }
          }
        }
      } else {
        // Handle JSON response (authenticated API)
        const instrumentsData = response.data.data || response.data;
        if (Array.isArray(instrumentsData)) {
          for (const instrument of instrumentsData) {
            symbols.push({
              symbol: instrument.trading_symbol,
              name: instrument.name,
              exchange: instrument.exchange,
              segment: instrument.segment,
              instrument_type: instrument.instrument_type,
              lot_size: parseInt(instrument.lot_size) || 1,
              tick_size: parseFloat(instrument.tick_size) || 0.05,
              expiry: instrument.expiry || null,
              strike: parseFloat(instrument.strike_price) || null,
              option_type: instrument.option_type || null,
              broker_token: instrument.instrument_key,
              broker_exchange: instrument.exchange,
              broker_symbol: instrument.trading_symbol,
              isin: instrument.isin || null,
              weekly_expiry: instrument.weekly_expiry || null,
              // Webhook format fields
              instrument_token: instrument.instrument_key,
              trading_symbol: instrument.trading_symbol
            });
          }
        }
      }
      
      logger.info(`Fetched ${symbols.length} symbols from Upstox`);
      return symbols;
      
    } catch (error) {
      logger.error('Failed to fetch Upstox symbols:', error);
      throw new Error(`Upstox symbol fetch failed: ${error.message}`);
    }
  }

  // Fetch symbols from Angel Broking
  async fetchAngelSymbols() {
    try {
      logger.info('Fetching Angel Broking symbols');
      
      // Angel provides public master contract files
      const symbols = [];
      
      try {
        // Fetch the main instruments file
        const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json', {
          timeout: 60000
        });
        
        const data = response.data;
        if (Array.isArray(data)) {
          for (const instrument of data) {
            symbols.push({
              symbol: instrument.symbol,
              name: instrument.name,
              exchange: instrument.exch_seg,
              segment: instrument.exch_seg,
              instrument_type: instrument.instrumenttype,
              lot_size: parseInt(instrument.lotsize) || 1,
              tick_size: parseFloat(instrument.tick_size) || 0.05,
              expiry: instrument.expiry || null,
              strike: parseFloat(instrument.strike) || null,
              option_type: instrument.option_type || null,
              broker_token: instrument.token,
              broker_exchange: instrument.exch_seg,
              broker_symbol: instrument.symbol,
              // Additional Angel specific fields
              isin: instrument.isin || null,
              symbol_token: instrument.symboltoken || null,
              precision: parseInt(instrument.precision) || 2,
              // Webhook format fields
              symboltoken: instrument.symboltoken || instrument.token,
              tradingsymbol: instrument.symbol
            });
          }
        }
      } catch (mainError) {
        logger.warn('Failed to fetch main Angel symbols file, trying alternative sources:', mainError.message);
        
        // Try alternative endpoints for different exchanges
        const exchanges = [
          { name: 'NSE', url: 'https://margincalculator.angelbroking.com/OpenAPI_File/files/NSE_EQ.csv' },
          { name: 'BSE', url: 'https://margincalculator.angelbroking.com/OpenAPI_File/files/BSE_EQ.csv' },
          { name: 'NFO', url: 'https://margincalculator.angelbroking.com/OpenAPI_File/files/NSE_FO.csv' },
          { name: 'MCX', url: 'https://margincalculator.angelbroking.com/OpenAPI_File/files/MCX_FO.csv' }
        ];
        
        for (const exchange of exchanges) {
          try {
            const response = await axios.get(exchange.url, {
              timeout: 30000,
              responseType: 'text'
            });
            
            const lines = response.data.split('\n');
            const headers = lines[0].split(',');
            
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;
              
              const values = line.split(',');
              if (values.length >= headers.length) {
                const instrument = {};
                headers.forEach((header, index) => {
                  instrument[header.trim()] = values[index]?.trim() || '';
                });
                
                symbols.push({
                  symbol: instrument.symbol || instrument.trading_symbol,
                  name: instrument.name || instrument.company_name,
                  exchange: exchange.name,
                  segment: exchange.name,
                  instrument_type: instrument.instrumenttype || instrument.instrument_type,
                  lot_size: parseInt(instrument.lotsize || instrument.lot_size) || 1,
                  tick_size: parseFloat(instrument.tick_size) || 0.05,
                  expiry: instrument.expiry || null,
                  strike: parseFloat(instrument.strike) || null,
                  option_type: instrument.option_type || null,
                  broker_token: instrument.token || instrument.symboltoken,
                  broker_exchange: exchange.name,
                  broker_symbol: instrument.symbol || instrument.trading_symbol,
                  isin: instrument.isin || null,
                  symbol_token: instrument.symboltoken || null,
                  precision: parseInt(instrument.precision) || 2,
                  // Webhook format fields
                  symboltoken: instrument.symboltoken || instrument.token,
                  tradingsymbol: instrument.symbol || instrument.trading_symbol
                });
              }
            }
          } catch (exchangeError) {
            logger.warn(`Failed to fetch Angel symbols for ${exchange.name}:`, exchangeError.message);
          }
        }
      }
      
      logger.info(`Fetched ${symbols.length} symbols from Angel Broking`);
      return symbols;
      
    } catch (error) {
      logger.error('Failed to fetch Angel symbols:', error);
      throw new Error(`Angel symbol fetch failed: ${error.message}`);
    }
  }

  // Fetch symbols from Shoonya
  async fetchShoonyaSymbols() {
    try {
      logger.info('Fetching Shoonya symbols');
      
      const symbols = [];
      
      // Try different Shoonya endpoints
      const endpoints = [
        { name: 'NSE', url: 'https://api.shoonya.com/NSE_symbols.txt', segment: 'EQ' },
        { name: 'BSE', url: 'https://api.shoonya.com/BSE_symbols.txt', segment: 'EQ' },
        { name: 'NFO', url: 'https://api.shoonya.com/NFO_symbols.txt', segment: 'FO' },
        { name: 'MCX', url: 'https://api.shoonya.com/MCX_symbols.txt', segment: 'FO' }
      ];
      
      // Try alternative endpoints if main ones fail
      const alternativeEndpoints = [
        'https://shoonya.finvasia.com/NSE_symbols.txt',
        'https://shoonya.finvasia.com/BSE_symbols.txt',
        'https://shoonya.finvasia.com/NFO_symbols.txt'
      ];
      
      let totalFetched = 0;
      
      for (const endpoint of endpoints) {
        try {
          logger.info(`Fetching Shoonya symbols from ${endpoint.url}...`);
          const response = await axios.get(endpoint.url, {
            timeout: 60000,
            responseType: 'text'
          });
          
          if (response.data && response.data.length > 100) {
            const lines = response.data.split('\n');
            logger.info(`Processing ${lines.length} lines from ${endpoint.name}`);
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line || line.startsWith('#')) continue; // Skip comments
              
              // Try different separators (pipe, comma, tab)
              let values = line.split('|');
              if (values.length < 3) {
                values = line.split(',');
              }
              if (values.length < 3) {
                values = line.split('\t');
              }
              
              if (values.length >= 3) {
                const symbol = {
                  symbol: values[0]?.trim(),
                  name: values[1]?.trim() || values[0]?.trim(),
                  exchange: endpoint.name,
                  segment: endpoint.segment,
                  instrument_type: values[2]?.trim() || 'EQ',
                  lot_size: parseInt(values[3]) || 1,
                  tick_size: parseFloat(values[4]) || 0.05,
                  expiry: values[5] || null,
                  strike: parseFloat(values[6]) || null,
                  option_type: values[7] || null,
                  broker_token: values[8] || values[0], // Use symbol as token if not available
                  broker_exchange: endpoint.name,
                  broker_symbol: values[0]?.trim(),
                  // Additional Shoonya specific fields
                  token: values[8] || null,
                  precision: parseInt(values[9]) || 2,
                  // Webhook format fields
                  tsym: values[0]?.trim(),
                  exch: endpoint.name
                };
                
                // Only add if we have essential fields
                if (symbol.symbol && symbol.symbol.length > 0) {
                  symbols.push(symbol);
                  totalFetched++;
                }
              }
            }
            
            logger.info(`Successfully fetched ${totalFetched} symbols from ${endpoint.name}`);
          }
        } catch (endpointError) {
          logger.warn(`Failed to fetch from ${endpoint.url}:`, endpointError.message);
        }
      }
      
      // If no symbols fetched, try alternative approach
      if (symbols.length === 0) {
        logger.warn('No symbols fetched from main endpoints, trying alternative approach...');
        
        // Create some basic symbols for testing
        const basicSymbols = [
          { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', segment: 'EQ' },
          { symbol: 'TCS', name: 'Tata Consultancy Services Ltd', exchange: 'NSE', segment: 'EQ' },
          { symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', segment: 'EQ' },
          { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', segment: 'EQ' },
          { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE', segment: 'EQ' }
        ];
        
        for (const basic of basicSymbols) {
          symbols.push({
            ...basic,
            instrument_type: 'EQ',
            lot_size: 1,
            tick_size: 0.05,
            expiry: null,
            strike: null,
            option_type: null,
            broker_token: basic.symbol,
            broker_exchange: basic.exchange,
            token: basic.symbol,
            precision: 2
          });
        }
        
        logger.info('Added basic symbols for Shoonya as fallback');
      }
      
      logger.info(`Fetched ${symbols.length} symbols from Shoonya`);
      return symbols;
      
    } catch (error) {
      logger.error('Failed to fetch symbols from Shoonya:', error);
      return [];
    }
  }

  // Get cached instrument data for a broker
  getCachedInstruments(brokerName) {
    return this.instrumentCache.get(brokerName) || [];
  }

  // Cache instrument data
  setCachedInstruments(brokerName, instruments) {
    this.instrumentCache.set(brokerName, instruments);
    logger.info(`Cached ${instruments.length} instruments for ${brokerName}`);
  }

  // Get symbol with broker-specific token
  async getSymbolWithBrokerToken(symbol, exchange, brokerName) {
    try {
      const result = await db.getAsync(`
        SELECT 
          i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          i.lot_size, i.tick_size, i.expiry_date, i.strike_price, i.option_type,
          bim.broker_symbol, bim.broker_token, bim.broker_exchange
        FROM instruments i
        JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id
        WHERE i.symbol = ? AND i.exchange = ? AND bim.broker_name = ? AND bim.is_active = 1
        ORDER BY bim.updated_at DESC LIMIT 1
      `, [symbol, exchange, brokerName]);
      
      return result;
    } catch (error) {
      logger.error('Failed to get symbol with broker token:', error);
      return null;
    }
  }

  // Generate webhook payload for specific broker
  async generateWebhookPayload(symbol, exchange, brokerName, orderParams = {}) {
    try {
      const symbolData = await this.getSymbolWithBrokerToken(symbol, exchange, brokerName);
      
      if (!symbolData) {
        throw new Error(`Symbol ${symbol} not found for broker ${brokerName}`);
      }

      const defaultParams = {
        action: 'BUY',
        quantity: 1,
        order_type: 'MARKET',
        product: 'MIS',
        validity: 'DAY',
        price: 0,
        trigger_price: 0,
        disclosed_quantity: 0,
        tag: 'TradingView'
      };

      const params = { ...defaultParams, ...orderParams };
      let payload = {};

      switch (brokerName.toLowerCase()) {
        case 'zerodha':
          payload = {
            symbol: symbolData.symbol,
            action: params.action,
            quantity: parseInt(params.quantity),
            order_type: params.order_type,
            product: params.product,
            exchange: symbolData.exchange,
            validity: params.validity,
            price: params.order_type === 'LIMIT' ? parseFloat(params.price) : 0,
            trigger_price: ['SL', 'SL-M'].includes(params.order_type) ? parseFloat(params.trigger_price) : 0,
            disclosed_quantity: parseInt(params.disclosed_quantity),
            tag: params.tag
          };
          break;

        case 'upstox':
          payload = {
            symbol: symbolData.symbol,
            action: params.action,
            quantity: parseInt(params.quantity),
            order_type: params.order_type,
            product: params.product === 'MIS' ? 'I' : (params.product === 'CNC' ? 'D' : 'I'),
            exchange: symbolData.broker_exchange,
            validity: params.validity,
            price: params.order_type === 'LIMIT' ? parseFloat(params.price) : 0,
            trigger_price: ['SL', 'SL-M'].includes(params.order_type) ? parseFloat(params.trigger_price) : 0,
            disclosed_quantity: parseInt(params.disclosed_quantity),
            is_amo: false,
            tag: params.tag,
            instrument_token: symbolData.broker_token
          };
          break;

        case 'angel':
          payload = {
            symbol: symbolData.broker_symbol,
            symboltoken: symbolData.broker_token,
            action: params.action,
            quantity: parseInt(params.quantity),
            order_type: params.order_type,
            product: params.product === 'MIS' ? 'INTRADAY' : (params.product === 'CNC' ? 'DELIVERY' : 'INTRADAY'),
            exchange: symbolData.exchange,
            validity: params.validity,
            price: params.order_type === 'LIMIT' ? parseFloat(params.price).toString() : '0',
            squareoff: '0',
            stoploss: ['SL', 'SL-M'].includes(params.order_type) ? parseFloat(params.trigger_price).toString() : '0'
          };
          break;

        case 'shoonya':
          payload = {
            symbol: symbolData.symbol,
            action: params.action === 'BUY' ? 'B' : 'S',
            quantity: parseInt(params.quantity),
            order_type: params.order_type === 'MARKET' ? 'MKT' : (params.order_type === 'LIMIT' ? 'LMT' : 'MKT'),
            product: params.product === 'MIS' ? 'I' : (params.product === 'CNC' ? 'C' : 'I'),
            exchange: symbolData.exchange,
            validity: params.validity,
            price: params.order_type === 'LIMIT' ? parseFloat(params.price).toString() : '0',
            trigger_price: ['SL', 'SL-M'].includes(params.order_type) ? parseFloat(params.trigger_price).toString() : '0'
          };
          break;

        default:
          throw new Error(`Unsupported broker: ${brokerName}`);
      }
      return {
        broker: brokerName,
        symbol_data: symbolData,
        payload: payload,
        webhook_format: `${brokerName}_webhook`
      };

    } catch (error) {
      logger.error('Failed to generate webhook payload:', error);
      throw error;
    }
  }

  // Store symbols in database
  async storeSymbols(brokerName, symbols) {
    try {
      logger.info(`Storing ${symbols.length} symbols for ${brokerName}`);
      
      let stored = 0;
      let updated = 0;
      
      for (const symbol of symbols) {
        try {
          // First, insert or update the instrument
          const instrumentResult = await db.runAsync(`
            INSERT OR REPLACE INTO instruments (
              symbol, name, exchange, segment, instrument_type, lot_size, tick_size, 
              expiry_date, strike_price, option_type, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `, [
            symbol.symbol,
            symbol.name,
            symbol.exchange,
            symbol.segment,
            symbol.instrument_type,
            symbol.lot_size,
            symbol.tick_size,
            symbol.expiry,
            symbol.strike,
            symbol.option_type
          ]);
          
          // Get the instrument ID
          const instrument = await db.getAsync(`
            SELECT id FROM instruments 
            WHERE symbol = ? AND exchange = ? AND segment = ? 
            AND (expiry_date IS ? OR expiry_date = ?) 
            AND (strike_price IS ? OR strike_price = ?) 
            AND (option_type IS ? OR option_type = ?)
          `, [
            symbol.symbol, symbol.exchange, symbol.segment,
            symbol.expiry, symbol.expiry,
            symbol.strike, symbol.strike,
            symbol.option_type, symbol.option_type
          ]);
          
          if (instrument) {
            // Insert or update broker mapping
            await db.runAsync(`
              INSERT OR REPLACE INTO broker_instrument_mappings (
                instrument_id, broker_name, broker_symbol, broker_token, 
                broker_exchange, is_active, updated_at
              ) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
            `, [
              instrument.id,
              brokerName,
              symbol.broker_symbol || symbol.symbol,
              symbol.broker_token,
              symbol.broker_exchange
            ]);
            
            if (instrumentResult.changes > 0) {
              stored++;
            } else {
              updated++;
            }
          }
          
        } catch (symbolError) {
          logger.warn(`Failed to store symbol ${symbol.symbol}:`, symbolError.message);
        }
      }
      
      // Cache the instruments for this broker
      this.setCachedInstruments(brokerName, symbols);
      
      logger.info(`Symbol storage completed for ${brokerName}`, { stored, updated });
      return { stored, updated };
      
    } catch (error) {
      logger.error(`Failed to store symbols for ${brokerName}:`, error);
      throw error;
    }
  }

  // Save symbols to JSON and CSV files
  async saveSymbolsToFile(brokerName, symbols) {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const jsonFilePath = path.join(this.dataDir, `${brokerName}_symbols_${timestamp}.json`);
      const csvFilePath = path.join(this.dataDir, `${brokerName}_symbols_${timestamp}.csv`);
      const latestJsonPath = path.join(this.dataDir, `${brokerName}_symbols_latest.json`);
      const latestCsvPath = path.join(this.dataDir, `${brokerName}_symbols_latest.csv`);
      
      // Save as JSON
      const jsonData = {
        broker: brokerName,
        timestamp: new Date().toISOString(),
        total_symbols: symbols.length,
        symbols: symbols
      };
      
      await fs.writeFile(jsonFilePath, JSON.stringify(jsonData, null, 2));
      await fs.writeFile(latestJsonPath, JSON.stringify(jsonData, null, 2));
      
      // Save as CSV
      if (symbols.length > 0) {
        const headers = Object.keys(symbols[0]);
        const csvContent = [
          headers.join(','),
          ...symbols.map(symbol => 
            headers.map(header => {
              const value = symbol[header];
              // Escape commas and quotes in CSV
              if (value === null || value === undefined) return '';
              const stringValue = String(value);
              if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
              }
              return stringValue;
            }).join(',')
          )
        ].join('\n');
        
        await fs.writeFile(csvFilePath, csvContent);
        await fs.writeFile(latestCsvPath, csvContent);
      }
      
      logger.info(`Symbols saved to files for ${brokerName}`, {
        jsonFile: jsonFilePath,
        csvFile: csvFilePath,
        symbolCount: symbols.length
      });
      
    } catch (error) {
      logger.error(`Failed to save symbols to file for ${brokerName}:`, error);
      // Don't throw error as this is not critical for the sync process
    }
  }

  // Load symbols from file (for quick access)
  async loadSymbolsFromFile(brokerName) {
    try {
      const latestJsonPath = path.join(this.dataDir, `${brokerName}_symbols_latest.json`);
      const fileContent = await fs.readFile(latestJsonPath, 'utf8');
      const data = JSON.parse(fileContent);
      
      logger.info(`Loaded ${data.symbols.length} symbols from file for ${brokerName}`);
      return data.symbols;
      
    } catch (error) {
      logger.warn(`Failed to load symbols from file for ${brokerName}:`, error.message);
      return [];
    }
  }

  // Get available symbol files
  async getSymbolFiles() {
    try {
      const files = await fs.readdir(this.dataDir);
      const symbolFiles = files.filter(file => 
        file.includes('_symbols_') && (file.endsWith('.json') || file.endsWith('.csv'))
      );
      
      const fileInfo = [];
      for (const file of symbolFiles) {
        const filePath = path.join(this.dataDir, file);
        const stats = await fs.stat(filePath);
        const [broker, , date] = file.replace(/\.(json|csv)$/, '').split('_');
        
        fileInfo.push({
          filename: file,
          broker: broker,
          date: date === 'latest' ? 'latest' : date,
          size: stats.size,
          modified: stats.mtime,
          type: file.endsWith('.json') ? 'json' : 'csv'
        });
      }
      
      return fileInfo.sort((a, b) => b.modified - a.modified);
      
    } catch (error) {
      logger.error('Failed to get symbol files:', error);
      return [];
    }
  }

  // Helper method to parse CSV lines with quoted values
  parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    result.push(current);
    return result;
  }

  // Update sync status with better error handling
  async updateSyncStatus(brokerName, status, errorMessage = null, totalSymbols = 0) {
    try {
      logger.info(`Updating sync status for ${brokerName}: ${status} (${totalSymbols} symbols)`);
      
      const result = await db.runAsync(`
        INSERT OR REPLACE INTO symbol_sync_status (
          broker_name, last_sync_at, sync_status, total_symbols, error_message, updated_at
        ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [brokerName, status, totalSymbols, errorMessage]);
      
      logger.info(`Sync status updated successfully for ${brokerName}`, { 
        changes: result.changes,
        lastID: result.lastID 
      });
      
    } catch (error) {
      logger.error('Failed to update sync status:', error);
      throw error; // Re-throw to ensure calling code knows about the failure
    }
  }

  // Get sync status for all brokers
  async getSyncStatus() {
    try {
      const statuses = await db.allAsync(`
        SELECT * FROM symbol_sync_status ORDER BY updated_at DESC
      `);
      
      return statuses;
    } catch (error) {
      logger.error('Failed to get sync status:', error);
      throw error;
    }
  }

  // Search symbols across all brokers
  async searchSymbols(query, exchange = null, limit = 50) {
    try {
      let sql = `
        SELECT DISTINCT 
          i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          GROUP_CONCAT(bim.broker_name) as supported_brokers,
          GROUP_CONCAT(bim.broker_token) as broker_tokens
        FROM instruments i
        LEFT JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id
        WHERE (i.symbol LIKE ? OR i.name LIKE ?)
      `;
      
      const params = [`%${query}%`, `%${query}%`];
      
      if (exchange) {
        sql += ` AND i.exchange = ?`;
        params.push(exchange);
      }
      
      sql += ` GROUP BY i.id ORDER BY i.symbol LIMIT ?`;
      params.push(limit);
      
      const results = await db.allAsync(sql, params);
      
      return results.map(row => ({
        ...row,
        supported_brokers: row.supported_brokers ? row.supported_brokers.split(',') : [],
        broker_tokens: row.broker_tokens ? row.broker_tokens.split(',') : []
      }));
      
    } catch (error) {
      logger.error('Failed to search symbols:', error);
      throw error;
    }
  }

  // Get broker-specific symbol mapping
  async getBrokerSymbolMapping(brokerName, symbol, exchange) {
    try {
      const result = await db.getAsync(`
        SELECT 
          i.symbol, i.name, i.exchange, i.segment,
          bim.broker_symbol, bim.broker_token, bim.broker_exchange
        FROM instruments i
        JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id
        WHERE bim.broker_name = ? AND i.symbol = ? AND i.exchange = ?
        AND bim.is_active = 1
      `, [brokerName, symbol, exchange]);
      
      return result;
    } catch (error) {
      logger.error('Failed to get broker symbol mapping:', error);
      throw error;
    }
  }

  // Get detailed symbol information with all broker mappings
  async getSymbolDetails(symbol, exchange) {
    try {
      const symbolInfo = await db.getAsync(`
        SELECT * FROM instruments 
        WHERE symbol = ? AND exchange = ?
        ORDER BY updated_at DESC LIMIT 1
      `, [symbol, exchange]);
      
      if (!symbolInfo) {
        return null;
      }
      
      // Get all broker mappings for this symbol
      const brokerMappings = await db.allAsync(`
        SELECT 
          broker_name, broker_symbol, broker_token, broker_exchange,
          is_active, updated_at
        FROM broker_instrument_mappings 
        WHERE instrument_id = ? AND is_active = 1
        ORDER BY broker_name
      `, [symbolInfo.id]);
      
      return {
        ...symbolInfo,
        broker_mappings: brokerMappings,
        supported_brokers: brokerMappings.map(m => m.broker_name)
      };
      
    } catch (error) {
      logger.error('Failed to get symbol details:', error);
      throw error;
    }
  }

  // Search symbols by segment
  async searchSymbolsBySegment(query, segment, exchange = null, options = {}) {
    try {
      const {
        broker = null,
        instrument_type = null,
        limit = 50,
        include_expired = false
      } = options;
      
      let sql = `
        SELECT DISTINCT 
          i.id, i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          i.lot_size, i.tick_size, i.expiry_date, i.strike_price, i.option_type,
          GROUP_CONCAT(bim.broker_name) as supported_brokers,
          GROUP_CONCAT(bim.broker_token) as broker_tokens,
          CASE 
            WHEN i.symbol = ? THEN 1
            WHEN i.symbol LIKE ? THEN 2
            WHEN i.name LIKE ? THEN 3
            ELSE 4
          END as relevance_score
        FROM instruments i
        LEFT JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id AND bim.is_active = 1
        WHERE (i.symbol LIKE ? OR i.name LIKE ?) AND i.segment = ?
      `;
      
      const params = [
        query, // exact match
        `${query}%`, // starts with
        `%${query}%`, // name contains
        `%${query}%`, // symbol contains
        `%${query}%`, // name contains
        segment
      ];
      
      if (exchange) {
        sql += ` AND i.exchange = ?`;
        params.push(exchange);
      }
      
      if (instrument_type) {
        sql += ` AND i.instrument_type = ?`;
        params.push(instrument_type);
      }
      
      if (broker) {
        sql += ` AND bim.broker_name = ?`;
        params.push(broker);
      }
      
      if (!include_expired) {
        sql += ` AND (i.expiry_date IS NULL OR i.expiry_date >= date('now'))`;
      }
      
      sql += ` GROUP BY i.id ORDER BY relevance_score, i.symbol LIMIT ?`;
      params.push(limit);
      
      const results = await db.allAsync(sql, params);
      
      return results.map(row => ({
        ...row,
        supported_brokers: row.supported_brokers ? row.supported_brokers.split(',') : [],
        broker_tokens: row.broker_tokens ? row.broker_tokens.split(',') : []
      }));
      
    } catch (error) {
      logger.error('Failed to search symbols by segment:', error);
      throw error;
    }
  }

  // Enhanced search with fuzzy matching and ranking
  async enhancedSymbolSearch(query, options = {}) {
    try {
      const {
        exchange = null,
        segment = null,
        broker = null,
        instrument_type = null,
        limit = 50,
        include_expired = false
      } = options;
      
      let sql = `
        SELECT DISTINCT 
          i.id, i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          i.lot_size, i.tick_size, i.expiry_date, i.strike_price, i.option_type,
          GROUP_CONCAT(bim.broker_name) as supported_brokers,
          GROUP_CONCAT(bim.broker_token) as broker_tokens,
          GROUP_CONCAT(bim.broker_exchange) as broker_exchanges,
          CASE 
            WHEN i.symbol = ? THEN 1
            WHEN i.symbol LIKE ? THEN 2
            WHEN i.name LIKE ? THEN 3
            ELSE 4
          END as relevance_score
        FROM instruments i
        LEFT JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id AND bim.is_active = 1
        WHERE (i.symbol LIKE ? OR i.name LIKE ?)
      `;
      
      const params = [
        query, // exact match
        `${query}%`, // starts with
        `%${query}%`, // name contains
        `%${query}%`, // symbol contains
        `%${query}%`  // name contains
      ];
      
      if (exchange) {
        sql += ` AND i.exchange = ?`;
        params.push(exchange);
      }
      
      if (segment) {
        sql += ` AND i.segment = ?`;
        params.push(segment);
      }
      
      if (instrument_type) {
        sql += ` AND i.instrument_type = ?`;
        params.push(instrument_type);
      }
      
      if (broker) {
        sql += ` AND bim.broker_name = ?`;
        params.push(broker);
      }
      
      if (!include_expired) {
        sql += ` AND (i.expiry_date IS NULL OR i.expiry_date >= date('now'))`;
      }
      
      sql += ` GROUP BY i.id ORDER BY relevance_score, i.symbol LIMIT ?`;
      params.push(limit);
      
      const results = await db.allAsync(sql, params);
      
      return results.map(row => ({
        ...row,
        supported_brokers: row.supported_brokers ? row.supported_brokers.split(',') : [],
        broker_tokens: row.broker_tokens ? row.broker_tokens.split(',') : [],
        broker_exchanges: row.broker_exchanges ? row.broker_exchanges.split(',') : []
      }));
      
    } catch (error) {
      logger.error('Failed to perform enhanced symbol search:', error);
      throw error;
    }
  }

  // Get symbols by exchange
  async getSymbolsByExchange(exchange, limit = 100) {
    try {
      const results = await db.allAsync(`
        SELECT DISTINCT 
          i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          GROUP_CONCAT(bim.broker_name) as supported_brokers
        FROM instruments i
        LEFT JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id AND bim.is_active = 1
        WHERE i.exchange = ?
        GROUP BY i.id
        ORDER BY i.symbol
        LIMIT ?
      `, [exchange, limit]);
      
      return results.map(row => ({
        ...row,
        supported_brokers: row.supported_brokers ? row.supported_brokers.split(',') : []
      }));
      
    } catch (error) {
      logger.error('Failed to get symbols by exchange:', error);
      throw error;
    }
  }

  // Get popular/most traded symbols
  async getPopularSymbols(limit = 20) {
    try {
      // This would ideally be based on trading volume or user activity
      // For now, return symbols that are supported by most brokers
      const results = await db.allAsync(`
        SELECT 
          i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          COUNT(bim.broker_name) as broker_count,
          GROUP_CONCAT(bim.broker_name) as supported_brokers
        FROM instruments i
        LEFT JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id AND bim.is_active = 1
        WHERE i.instrument_type = 'EQ' AND i.exchange IN ('NSE', 'BSE')
        GROUP BY i.id
        HAVING broker_count > 1
        ORDER BY broker_count DESC, i.symbol
        LIMIT ?
      `, [limit]);
      
      return results.map(row => ({
        ...row,
        supported_brokers: row.supported_brokers ? row.supported_brokers.split(',') : []
      }));
      
    } catch (error) {
      logger.error('Failed to get popular symbols:', error);
      throw error;
    }
  }

  // Get available segments with symbol counts
  async getAvailableSegments() {
    try {
      const results = await db.allAsync(`
        SELECT 
          i.segment,
          i.exchange,
          COUNT(DISTINCT i.id) as symbol_count,
          COUNT(DISTINCT bim.broker_name) as broker_count,
          GROUP_CONCAT(DISTINCT bim.broker_name) as supported_brokers
        FROM instruments i
        LEFT JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id AND bim.is_active = 1
        GROUP BY i.segment, i.exchange
        HAVING symbol_count > 0
        ORDER BY i.exchange, i.segment
      `);
      
      return results.map(row => ({
        ...row,
        supported_brokers: row.supported_brokers ? row.supported_brokers.split(',') : [],
        display_name: this.getSegmentDisplayName(row.segment, row.exchange)
      }));
      
    } catch (error) {
      logger.error('Failed to get available segments:', error);
      throw error;
    }
  }

  // Get segment display name for better UX
  getSegmentDisplayName(segment, exchange) {
    const segmentMap = {
      // NSE segments
      'NSE': {
        'NSE': 'NSE Equity',
        'EQ': 'NSE Equity',
        'EQUITY': 'NSE Equity',
        'CM': 'NSE Capital Market',
        'INDICES': 'NSE Indices'
      },
      // BSE segments
      'BSE': {
        'BSE': 'BSE Equity',
        'EQ': 'BSE Equity',
        'EQUITY': 'BSE Equity',
        'CM': 'BSE Capital Market',
        'INDICES': 'BSE Indices'
      },
      // NSE F&O segments
      'NFO': {
        'NFO': 'NSE F&O (All)',
        'NFO-FUT': 'NSE Futures',
        'NFO-OPT': 'NSE Options',
        'FO': 'NSE F&O',
        'FUTURES': 'NSE Futures',
        'OPTIONS': 'NSE Options'
      },
      // BSE F&O segments
      'BFO': {
        'BFO': 'BSE F&O (All)',
        'BFO-FUT': 'BSE Futures',
        'BFO-OPT': 'BSE Options',
        'FO': 'BSE F&O',
        'FUTURES': 'BSE Futures',
        'OPTIONS': 'BSE Options'
      },
      // MCX segments
      'MCX': {
        'MCX': 'MCX Commodity',
        'MCX-FUT': 'MCX Futures',
        'MCX-OPT': 'MCX Options',
        'FO': 'MCX Commodity',
        'FUTURES': 'MCX Futures',
        'COMMODITY': 'MCX Commodity',
        'INDICES': 'MCX Indices'
      },
      // Currency Derivatives
      'CDS': {
        'CDS': 'Currency Derivatives',
        'CDS-FUT': 'Currency Futures',
        'CDS-OPT': 'Currency Options',
        'CD': 'Currency Derivatives'
      },
      // NCO (NSE Commodity)
      'NCO': {
        'NCO': 'NSE Commodity',
        'NCO-FUT': 'NSE Commodity Futures',
        'NCO-OPT': 'NSE Commodity Options'
      },
      // Global Indices
      'GLOBAL': {
        'INDICES': 'Global Indices'
      },
      // NSE International Exchange
      'NSEIX': {
        'INDICES': 'NSE International Indices'
      }
    };

    // First try exact match with exchange and segment
    const exchangeSegments = segmentMap[exchange];
    if (exchangeSegments && exchangeSegments[segment]) {
      return exchangeSegments[segment];
    }

    // Fallback to a more readable format
    const readableNames = {
      'NSE': 'NSE Equity',
      'BSE': 'BSE Equity',
      'NFO': 'NSE F&O',
      'BFO': 'BSE F&O',
      'MCX': 'MCX Commodity',
      'CDS': 'Currency Derivatives',
      'NCO': 'NSE Commodity',
      'GLOBAL': 'Global',
      'NSEIX': 'NSE International'
    };

    // Try to create a readable name
    const exchangeName = readableNames[exchange] || exchange;
    
    if (segment.includes('-FUT') || segment.includes('FUT')) {
      return `${exchangeName} Futures`;
    } else if (segment.includes('-OPT') || segment.includes('OPT')) {
      return `${exchangeName} Options`;
    } else if (segment === 'INDICES') {
      return `${exchangeName} Indices`;
    } else if (segment === exchange) {
      // When segment equals exchange (like NSE/NSE, BSE/BSE)
      return exchangeName;
    } else {
      return `${exchangeName} ${segment}`;
    }
  }

  // Search symbols by segment with enhanced filtering
  async searchSymbolsBySegment(query, segment, exchange, options = {}) {
    try {
      const {
        broker = null,
        instrument_type = null,
        limit = 50,
        include_expired = false
      } = options;

      if (!segment) {
        throw new Error('Segment is required for segment-specific search');
      }

      let sql = `
        SELECT DISTINCT 
          i.id, i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          i.lot_size, i.tick_size, i.expiry_date, i.strike_price, i.option_type,
          GROUP_CONCAT(bim.broker_name) as supported_brokers,
          GROUP_CONCAT(bim.broker_token) as broker_tokens,
          GROUP_CONCAT(bim.broker_exchange) as broker_exchanges,
          CASE 
            WHEN i.symbol = ? THEN 1
            WHEN i.symbol LIKE ? THEN 2
            WHEN i.name LIKE ? THEN 3
            ELSE 4
          END as relevance_score
        FROM instruments i
        LEFT JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id AND bim.is_active = 1
        WHERE i.segment = ? AND (i.symbol LIKE ? OR i.name LIKE ?)
      `;
      
      const params = [
        query, // exact match
        `${query}%`, // starts with
        `%${query}%`, // name contains
        segment, // segment filter
        `%${query}%`, // symbol contains
        `%${query}%`  // name contains
      ];
      
      if (exchange) {
        sql += ` AND i.exchange = ?`;
        params.push(exchange);
      }
      
      if (instrument_type) {
        sql += ` AND i.instrument_type = ?`;
        params.push(instrument_type);
      }
      
      if (broker) {
        sql += ` AND bim.broker_name = ?`;
        params.push(broker);
      }
      
      if (!include_expired) {
        sql += ` AND (i.expiry_date IS NULL OR i.expiry_date >= date('now'))`;
      }
      
      sql += ` GROUP BY i.id ORDER BY relevance_score, i.symbol LIMIT ?`;
      params.push(limit);
      
      const results = await db.allAsync(sql, params);
      
      return results.map(row => ({
        ...row,
        supported_brokers: row.supported_brokers ? row.supported_brokers.split(',') : [],
        broker_tokens: row.broker_tokens ? row.broker_tokens.split(',') : [],
        broker_exchanges: row.broker_exchanges ? row.broker_exchanges.split(',') : []
      }));
      
    } catch (error) {
      logger.error('Failed to search symbols by segment:', error);
      throw error;
    }
  }
  // Get comprehensive symbol mapping for webhook generation
  async getSymbolMappingForWebhook(symbol, exchange, brokerName) {
    try {
      const result = await db.getAsync(`
        SELECT 
          i.id, i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
          i.lot_size, i.tick_size, i.expiry_date, i.strike_price, i.option_type,
          bim.broker_symbol, bim.broker_token, bim.broker_exchange,
          bim.updated_at as mapping_updated
        FROM instruments i
        JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id
        WHERE i.symbol = ? AND i.exchange = ? AND bim.broker_name = ? AND bim.is_active = 1
        ORDER BY bim.updated_at DESC LIMIT 1
      `, [symbol, exchange, brokerName]);
      
      if (!result) {
        // Try fuzzy search
        const fuzzyResult = await db.getAsync(`
          SELECT 
            i.id, i.symbol, i.name, i.exchange, i.segment, i.instrument_type,
            i.lot_size, i.tick_size, i.expiry_date, i.strike_price, i.option_type,
            bim.broker_symbol, bim.broker_token, bim.broker_exchange,
            bim.updated_at as mapping_updated
          FROM instruments i
          JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id
          WHERE i.symbol LIKE ? AND i.exchange = ? AND bim.broker_name = ? AND bim.is_active = 1
          ORDER BY bim.updated_at DESC LIMIT 1
        `, [`%${symbol}%`, exchange, brokerName]);
        
        return fuzzyResult;
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to get symbol mapping for webhook:', error);
      return null;
    }
  }

  // Validate symbol for broker compatibility
  async validateSymbolForBroker(symbol, exchange, brokerName) {
    try {
      const mapping = await this.getSymbolMappingForWebhook(symbol, exchange, brokerName);
      
      if (!mapping) {
        return {
          valid: false,
          error: `Symbol ${symbol} not found for broker ${brokerName}`,
          suggestions: await this.getSimilarSymbols(symbol, exchange, brokerName)
        };
      }
      
      return {
        valid: true,
        mapping: mapping,
        broker_token: mapping.broker_token,
        broker_symbol: mapping.broker_symbol
      };
    } catch (error) {
      logger.error('Failed to validate symbol for broker:', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Get similar symbols for suggestions
  async getSimilarSymbols(symbol, exchange, brokerName, limit = 5) {
    try {
      const results = await db.allAsync(`
        SELECT DISTINCT 
          i.symbol, i.name, i.exchange, i.segment,
          bim.broker_symbol, bim.broker_token
        FROM instruments i
        JOIN broker_instrument_mappings bim ON i.id = bim.instrument_id
        WHERE i.symbol LIKE ? AND i.exchange = ? AND bim.broker_name = ? AND bim.is_active = 1
        ORDER BY 
          CASE 
            WHEN i.symbol = ? THEN 1
            WHEN i.symbol LIKE ? THEN 2
            ELSE 3
          END,
          i.symbol
        LIMIT ?
      `, [`%${symbol}%`, exchange, brokerName, symbol, `${symbol}%`, limit]);
      
      return results;
    } catch (error) {
      logger.error('Failed to get similar symbols:', error);
      return [];
    }
  }
}

const symbolSyncService = new SymbolSyncService();
export default symbolSyncService;