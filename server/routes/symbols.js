import express from 'express';
import path from 'path';
import { authenticateToken } from '../middleware/auth.js';
import symbolSyncService from '../services/symbolSyncService.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('SymbolsAPI');

// Get sync status for all brokers
router.get('/sync-status', authenticateToken, async (req, res) => {
  try {
    logger.info('Getting symbol sync status');
    
    const statuses = await symbolSyncService.getSyncStatus();
    
    res.json({
      success: true,
      data: statuses
    });
    
  } catch (error) {
    logger.error('Failed to get sync status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get sync status',
      error: error.message
    });
  }
});

// Get all symbols with optional filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search, exchange, segment, limit = 100 } = req.query;
    
    logger.info('Getting symbols with filters:', { search, exchange, segment, limit });
    
    let symbols = [];
    
    if (search) {
      // Use search if provided
      symbols = await symbolSyncService.enhancedSymbolSearch(search, {
        exchange,
        segment,
        limit: parseInt(limit)
      });
    } else {
      // Get symbols by other filters
      if (exchange) {
        symbols = await symbolSyncService.getSymbolsByExchange(exchange, parseInt(limit));
      } else {
        // Default to popular symbols if no filters
        symbols = await symbolSyncService.getPopularSymbols(parseInt(limit));
      }
    }
    
    res.json({
      success: true,
      data: symbols,
      count: symbols.length
    });
    
  } catch (error) {
    logger.error('Failed to get symbols:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get symbols',
      error: error.message
    });
  }
});

// Sync symbols for all brokers
router.post('/sync-all', authenticateToken, async (req, res) => {
  try {
    logger.info('Starting symbol sync for all brokers');
    
    // Start sync in background
    symbolSyncService.syncAllBrokers().catch(error => {
      logger.error('Background sync failed:', error);
    });
    
    res.json({
      success: true,
      message: 'Symbol sync started for all brokers'
    });
    
  } catch (error) {
    logger.error('Failed to start symbol sync:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start symbol sync',
      error: error.message
    });
  }
});

// Sync symbols for specific broker
router.post('/sync/:broker', authenticateToken, async (req, res) => {
  try {
    const { broker } = req.params;
    logger.info(`Starting symbol sync for ${broker}`);
    
    // Start sync in background
    symbolSyncService.syncBrokerSymbols(broker).catch(error => {
      logger.error(`Background sync failed for ${broker}:`, error);
    });
    
    res.json({
      success: true,
      message: `Symbol sync started for ${broker}`
    });
    
  } catch (error) {
    logger.error(`Failed to start symbol sync for ${req.params.broker}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to start symbol sync',
      error: error.message
    });
  }
});

// Search symbols
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q: query, exchange, limit = 50 } = req.query;
    
    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Query must be at least 2 characters long'
      });
    }
    
    logger.info(`Searching symbols for query: ${query}`);
    
    const results = await symbolSyncService.searchSymbols(query, exchange, parseInt(limit));
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
    
  } catch (error) {
    logger.error('Failed to search symbols:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search symbols',
      error: error.message
    });
  }
});

// Generate webhook payload for specific symbol and broker
router.post('/webhook/generate', authenticateToken, async (req, res) => {
  try {
    const { symbol, exchange, brokerName, orderParams = {} } = req.body;
    
    if (!symbol || !exchange || !brokerName) {
      return res.status(400).json({
        success: false,
        message: 'Symbol, exchange, and brokerName are required'
      });
    }
    
    logger.info(`Generating webhook payload for ${symbol} on ${exchange} for ${brokerName}`);
    
    const webhookData = await symbolSyncService.generateWebhookPayload(
      symbol, 
      exchange, 
      brokerName, 
      orderParams
    );
    
    res.json({
      success: true,
      data: webhookData
    });
    
  } catch (error) {
    logger.error('Failed to generate webhook payload:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate webhook payload',
      error: error.message
    });
  }
});

// Validate symbol for broker compatibility
router.post('/validate', authenticateToken, async (req, res) => {
  try {
    const { symbol, exchange, brokerName } = req.body;
    
    if (!symbol || !exchange || !brokerName) {
      return res.status(400).json({
        success: false,
        message: 'Symbol, exchange, and brokerName are required'
      });
    }
    
    logger.info(`Validating symbol ${symbol} for broker ${brokerName}`);
    
    const validation = await symbolSyncService.validateSymbolForBroker(
      symbol, 
      exchange, 
      brokerName
    );
    
    res.json({
      success: true,
      data: validation
    });
    
  } catch (error) {
    logger.error('Failed to validate symbol:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate symbol',
      error: error.message
    });
  }
});

// Get symbol mapping for webhook
router.get('/webhook-mapping/:broker/:symbol/:exchange', authenticateToken, async (req, res) => {
  try {
    const { broker, symbol, exchange } = req.params;
    
    logger.info(`Getting webhook mapping for ${symbol} on ${exchange} for ${broker}`);
    
    const mapping = await symbolSyncService.getSymbolMappingForWebhook(symbol, exchange, broker);
    
    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: 'Symbol mapping not found'
      });
    }
    
    res.json({
      success: true,
      data: mapping
    });
    
  } catch (error) {
    logger.error('Failed to get webhook mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get webhook mapping',
      error: error.message
    });
  }
});

// Get broker-specific symbol mapping
router.get('/mapping/:broker/:symbol/:exchange', authenticateToken, async (req, res) => {
  try {
    const { broker, symbol, exchange } = req.params;
    
    logger.info(`Getting ${broker} mapping for ${symbol} on ${exchange}`);
    
    const mapping = await symbolSyncService.getBrokerSymbolMapping(broker, symbol, exchange);
    
    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: 'Symbol mapping not found'
      });
    }
    
    res.json({
      success: true,
      data: mapping
    });
    
  } catch (error) {
    logger.error('Failed to get symbol mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get symbol mapping',
      error: error.message
    });
  }
});

// Get exchanges list
router.get('/exchanges', authenticateToken, async (req, res) => {
  try {
    logger.info('Getting exchanges list');
    
    const exchanges = [
      { code: 'NSE', name: 'National Stock Exchange', segments: ['EQ', 'FO'] },
      { code: 'BSE', name: 'Bombay Stock Exchange', segments: ['EQ', 'FO'] },
      { code: 'MCX', name: 'Multi Commodity Exchange', segments: ['FO'] },
      { code: 'NCDEX', name: 'National Commodity & Derivatives Exchange', segments: ['FO'] }
    ];
    
    res.json({
      success: true,
      data: exchanges
    });
    
  } catch (error) {
    logger.error('Failed to get exchanges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get exchanges',
      error: error.message
    });
  }
});

// Get symbol details with all broker mappings
router.get('/details/:symbol/:exchange', authenticateToken, async (req, res) => {
  try {
    const { symbol, exchange } = req.params;
    
    logger.info(`Getting details for ${symbol} on ${exchange}`);
    
    const details = await symbolSyncService.getSymbolDetails(symbol, exchange);
    
    if (!details) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found'
      });
    }
    
    res.json({
      success: true,
      data: details
    });
    
  } catch (error) {
    logger.error('Failed to get symbol details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get symbol details',
      error: error.message
    });
  }
});

// Enhanced symbol search with advanced options
router.get('/search/enhanced', authenticateToken, async (req, res) => {
  try {
    const { 
      q: query, 
      exchange, 
      segment,
      broker, 
      instrument_type, 
      limit = 50,
      include_expired = false 
    } = req.query;
    
    if (!query || query.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Query must be at least 3 characters long'
      });
    }
    
    logger.info(`Enhanced symbol search for query: ${query}, segment: ${segment}`);
    
    const results = await symbolSyncService.enhancedSymbolSearch(query, {
      exchange,
      segment,
      broker,
      instrument_type,
      limit: parseInt(limit),
      include_expired: include_expired === 'true'
    });
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
    
  } catch (error) {
    logger.error('Failed to perform enhanced symbol search:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search symbols',
      error: error.message
    });
  }
});

// Search symbols by segment (segment-specific search)
router.get('/search/segment', authenticateToken, async (req, res) => {
  try {
    const { 
      q: query, 
      segment,
      exchange,
      broker, 
      instrument_type, 
      limit = 50,
      include_expired = false 
    } = req.query;
    
    if (!query || query.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Query must be at least 3 characters long'
      });
    }

    if (!segment) {
      return res.status(400).json({
        success: false,
        message: 'Segment is required for segment-specific search'
      });
    }
    
    logger.info(`Segment-specific symbol search for query: ${query}, segment: ${segment}`);
    
    const results = await symbolSyncService.searchSymbolsBySegment(query, segment, exchange, {
      broker,
      instrument_type,
      limit: parseInt(limit),
      include_expired: include_expired === 'true'
    });
    
    res.json({
      success: true,
      data: results,
      count: results.length,
      segment: segment,
      exchange: exchange
    });
    
  } catch (error) {
    logger.error('Failed to perform segment-specific symbol search:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search symbols by segment',
      error: error.message
    });
  }
});

// Get available segments
router.get('/segments', authenticateToken, async (req, res) => {
  try {
    logger.info('Getting available segments');
    
    const segments = await symbolSyncService.getAvailableSegments();
    
    res.json({
      success: true,
      data: segments
    });
    
  } catch (error) {
    logger.error('Failed to get available segments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available segments',
      error: error.message
    });
  }
});

// Get symbols by exchange
router.get('/exchange/:exchange', authenticateToken, async (req, res) => {
  try {
    const { exchange } = req.params;
    const { limit = 100 } = req.query;
    
    logger.info(`Getting symbols for exchange: ${exchange}`);
    
    const results = await symbolSyncService.getSymbolsByExchange(exchange, parseInt(limit));
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
    
  } catch (error) {
    logger.error('Failed to get symbols by exchange:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get symbols by exchange',
      error: error.message
    });
  }
});

// Get popular symbols
router.get('/popular', authenticateToken, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    logger.info('Getting popular symbols');
    
    const results = await symbolSyncService.getPopularSymbols(parseInt(limit));
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
    
  } catch (error) {
    logger.error('Failed to get popular symbols:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get popular symbols',
      error: error.message
    });
  }
});

// Get symbol files information
router.get('/files', authenticateToken, async (req, res) => {
  try {
    logger.info('Getting symbol files information');
    
    const files = await symbolSyncService.getSymbolFiles();
    
    res.json({
      success: true,
      data: files
    });
    
  } catch (error) {
    logger.error('Failed to get symbol files:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get symbol files',
      error: error.message
    });
  }
});

// Download symbol file
router.get('/download/:broker/:type', authenticateToken, async (req, res) => {
  try {
    const { broker, type } = req.params;
    const { date = 'latest' } = req.query;
    
    if (!['json', 'csv'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Must be json or csv'
      });
    }
    
    const filename = date === 'latest' 
      ? `${broker}_symbols_latest.${type}`
      : `${broker}_symbols_${date}.${type}`;
    
    const filePath = path.join(process.cwd(), 'data', 'symbols', filename);
    
    logger.info(`Downloading symbol file: ${filename}`);
    
    // Check if file exists
    const fs = await import('fs/promises');
    try {
      await fs.access(filePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    res.download(filePath, filename);
    
  } catch (error) {
    logger.error('Failed to download symbol file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file',
      error: error.message
    });
  }
});

// Force sync for specific broker (admin endpoint)
router.post('/force-sync/:broker', authenticateToken, async (req, res) => {
  try {
    const { broker } = req.params;
    logger.info(`Force syncing symbols for ${broker}`);
    
    // Clear the last sync date to force sync
    symbolSyncService.lastSyncDate.delete(broker);
    
    // Start sync
    const result = await symbolSyncService.syncBrokerSymbols(broker);
    
    res.json({
      success: true,
      message: `Force sync completed for ${broker}`,
      data: result
    });
    
  } catch (error) {
    logger.error(`Failed to force sync for ${req.params.broker}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to force sync',
      error: error.message
    });
  }
});

// Get cached instruments for a broker
router.get('/cache/:broker', authenticateToken, async (req, res) => {
  try {
    const { broker } = req.params;
    const { limit = 100 } = req.query;
    
    logger.info(`Getting cached instruments for ${broker}`);
    
    const cachedInstruments = symbolSyncService.getCachedInstruments(broker);
    const limitedResults = cachedInstruments.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: {
        broker: broker,
        total_cached: cachedInstruments.length,
        returned: limitedResults.length,
        instruments: limitedResults
      }
    });
    
  } catch (error) {
    logger.error('Failed to get cached instruments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cached instruments',
      error: error.message
    });
  }
});

export default router;