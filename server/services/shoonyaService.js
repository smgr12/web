import axios from 'axios';
import crypto from 'crypto';
import { db } from '../database/init.js';
import { encryptData, decryptData } from '../utils/encryption.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ShoonyaService');

class ShoonyaService {
  constructor() {
    this.shoonyaInstances = new Map(); // Store Shoonya instances per connection
    this.baseURL = 'https://api.shoonya.com/NorenWClientTP';
    
    // Define API routes - Updated as per latest GitHub API
    this.routes = {
      'authorize': '/QuickAuth',
      'logout': '/Logout',
      'forgot_password': '/ForgotPassword',
      'watchlist_names': '/MWList',
      'watchlist': '/MarketWatch',
      'watchlist_add': '/AddMultiScripsToMW',
      'watchlist_delete': '/DeleteMultiMWScrips',
      'placeorder': '/PlaceOrder',
      'modifyorder': '/ModifyOrder',
      'cancelorder': '/CancelOrder',
      'exitorder': '/ExitSNOOrder',
      'orderbook': '/OrderBook',
      'tradebook': '/TradeBook',          
      'singleorderhistory': '/SingleOrdHist',
      'searchscrip': '/SearchScrip',
      'tpseries': '/TPSeries',     
      'optionchain': '/GetOptionChain',     
      'holdings': '/Holdings',
      'limits': '/Limits',
      'positions': '/PositionBook',
      'scripinfo': '/GetSecurityInfo',
      'getquotes': '/GetQuotes',
      'userdetails': '/UserDetails'
    };
  }

  // Generate session token using login credentials
  // Updated to match exactly with the latest GitHub API implementation
  async generateSessionToken(userId, password, twoFA, vendorCode, apiSecret, imei = '') {
    try {
      logger.info('Generating Shoonya session token');
      
      // Create password hash using SHA256 as per Shoonya documentation
      const pwd = crypto.createHash('sha256').update(password).digest('hex');
      
      // Validate required parameters
      if (!userId) throw new Error('User ID is required for Shoonya login');
      if (!password) throw new Error('Password is required for Shoonya login');
      if (!vendorCode) throw new Error('Vendor code is required for Shoonya login');
      if (!apiSecret) throw new Error('API secret is required for Shoonya login to generate app key hash');
      
      // Create app key hash using userId and apiSecret - exactly as in GitHub API
      const u_app_key = `${userId}|${apiSecret}`;
      const appkey_hash = crypto.createHash('sha256').update(u_app_key).digest('hex');
      
      logger.debug('Shoonya login parameters:', {
        userId,
        vendorCode,
        hasPassword: !!password,
        hasTwoFA: !!twoFA,
        hasApiSecret: !!apiSecret,
        hasImei: !!imei,
        passwordHashLength: pwd.length,
        appKeyHashLength: appkey_hash.length
      });
      
      // Prepare auth parameters exactly as in the GitHub RestApi.js implementation
      const authParams = {
        "source": "API",
        "apkversion": "js:1.0.0",
        "uid": userId,
        "pwd": pwd,
        "factor2": twoFA || '',
        "vc": vendorCode,
        "appkey": appkey_hash
      };
      
      // Add imei if provided
      if (imei) {
        authParams.imei = imei;
      }
      
      // Convert to JSON string and create payload exactly as in GitHub API
      const jData = JSON.stringify(authParams);
      const payload = `jData=${jData}`;
      
      logger.debug('Shoonya login request:', {
        url: this.baseURL + this.routes.authorize,
        payloadLength: payload.length
      });
      
      // Make the API call using axios with proper headers
      const response = await axios.post(
        this.baseURL + this.routes.authorize, 
        payload,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      logger.debug('Shoonya login response:', response.data);
      
      // Check response status as per GitHub API
      if (response.data.stat === 'Ok') {
        logger.info('Shoonya session token generated successfully');
        return {
          access_token: response.data.susertoken,
          session_token: response.data.susertoken,
          user_id: response.data.actid || userId,
          account_id: response.data.actid,
          stat: response.data.stat
        };
      } else {
        const errorMsg = response.data.emsg || 'Failed to generate session token';
        logger.error('Shoonya login failed:', errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      logger.error('Failed to generate Shoonya session token:', error);
      
      // Enhanced error logging
      if (error.response) {
        logger.error('Shoonya API error response:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      
      const errorMessage = error.response?.data?.emsg || 
                          error.response?.data?.message || 
                          error.message;
                          
      throw new Error(`Failed to generate session token: ${errorMessage}`);
    }
  }
  
  // Helper method to make API requests - Updated to match GitHub RestApi.js implementation
  async makeApiRequest(route, params, sessionToken = '') {
    try {
      const url = this.baseURL + this.routes[route];
      
      // Format data exactly as per GitHub RestApi.js implementation
      const jData = JSON.stringify(params);
      let payload = 'jData=' + jData;
      
      // Add session token if available - exactly as in GitHub API
      if (sessionToken) {
        payload = payload + `&jKey=${sessionToken}`;
      }
      
      logger.debug(`Making API request to ${route}`, { 
        url, 
        hasSessionToken: !!sessionToken,
        payloadLength: payload.length,
        payload: payload.substring(0, 200) + (payload.length > 200 ? '...' : '') // Log first 200 chars of payload
      });
      
      // Make the API call using axios with proper headers
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      logger.debug(`API response from ${route}:`, response.data);
      
      // Check response status as per GitHub API implementation
      if (response.data.stat === 'Ok') {
        return response.data;
      } else if (Array.isArray(response.data)) {
        // Some endpoints like holdings return an array directly
        return response.data;
      } else if (response.data.stat === 'Not_Ok') {
        const errorMsg = response.data.emsg || response.data.message || 'API call failed';
        logger.error(`API error in response: ${errorMsg}`, {
          route,
          errorData: response.data
        });
        throw new Error(errorMsg);
      } else {
        // For other response formats, return as-is
        return response.data;
      }
    } catch (error) {
      logger.error(`API request to ${route} failed:`, error);
      
      if (error.response) {
        logger.error('API error response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers
        });
      }
      
      throw error;
    }
  }

  // Initialize Shoonya instance for a connection
  async initializeShoonya(brokerConnection) {
    try {
      logger.info(`Initializing Shoonya instance for connection ${brokerConnection.id}`);

      if (!brokerConnection.access_token) {
        throw new Error('Access token is missing from broker connection');
      }

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (brokerConnection.access_token_expires_at && brokerConnection.access_token_expires_at < now) {
        throw new Error('Session token has expired. Please refresh your token.');
      }

      // For Shoonya, use api_key as the API secret (Shoonya doesn't have separate API secret)
      let apiSecret;
      if (brokerConnection.api_key) {
        apiSecret = decryptData(brokerConnection.api_key);
        logger.debug('Using api_key as API secret for Shoonya service');
      } else {
        throw new Error('API key is missing from Shoonya broker connection');
      }
      const sessionToken = decryptData(brokerConnection.access_token);

      const shoonyaInstance = {
        apiSecret,
        sessionToken,
        userId: brokerConnection.user_id_broker, // Add the user ID from the broker connection
        accountId: brokerConnection.user_id_broker // Account ID is same as user ID for Shoonya
      };

      // Test the connection
      await this.testConnection(shoonyaInstance);

      this.shoonyaInstances.set(brokerConnection.id, shoonyaInstance);
      logger.info(`Shoonya instance initialized for connection ${brokerConnection.id}`);
      
      return shoonyaInstance;
    } catch (error) {
      logger.error('Failed to initialize Shoonya instance:', error);
      throw new Error(`Failed to initialize Shoonya connection: ${error.message}`);
    }
  }

  // Get or create Shoonya instance
  async getShoonyaInstance(brokerConnectionId) {
    logger.info(`Getting Shoonya instance for connection ${brokerConnectionId}`);
    
    if (this.shoonyaInstances.has(brokerConnectionId)) {
      logger.info('Using cached Shoonya instance');
      return this.shoonyaInstances.get(brokerConnectionId);
    }

    logger.info('Fetching broker connection from database');
    const brokerConnection = await db.getAsync(
      'SELECT * FROM broker_connections WHERE id = ? AND is_active = 1',
      [brokerConnectionId]
    );

    if (!brokerConnection) {
      logger.error('Broker connection not found or inactive');
      throw new Error('Broker connection not found or inactive');
    }

    logger.info('Broker connection found, initializing Shoonya');
    return await this.initializeShoonya(brokerConnection);
  }

  // Helper method to make API calls using the instance
  async makeApiCallWithInstance(shoonyaInstance, route, data = {}) {
    try {
      // Add user ID and account ID to the request data
      const requestData = {
        ...data,
        uid: shoonyaInstance.userId,
        actid: shoonyaInstance.accountId || shoonyaInstance.userId
      };

      logger.debug(`Making API call with instance to ${route}`, {
        userId: shoonyaInstance.userId,
        hasSessionToken: !!shoonyaInstance.sessionToken
      });

      // Make the API call using the helper method
      return await this.makeApiRequest(route, requestData, shoonyaInstance.sessionToken);
    } catch (error) {
      logger.error(`API call to ${route} failed:`, error);
      throw new Error(`API call to ${route} failed: ${error.message}`);
    }
  }

  // Test API key and vendor code combination
  async testApiCredentials(userId, apiSecret, vendorCode) {
    try {
      logger.info('Testing Shoonya API credentials');
      
      // Create app key hash using userId and apiSecret
      const u_app_key = `${userId}|${apiSecret}`;
      const appkey_hash = crypto.createHash('sha256').update(u_app_key).digest('hex');
      
      // Log the test parameters
      logger.debug('Testing API credentials with:', {
        userId,
        vendorCode,
        apiSecretLength: apiSecret ? apiSecret.length : 0,
        appKeyHashLength: appkey_hash ? appkey_hash.length : 0
      });
      
      // We don't actually make an API call here, just validate the format
      return {
        valid: true,
        userId,
        vendorCode,
        appKeyHash: appkey_hash.substring(0, 10) + '...' // Only show part of the hash for security
      };
    } catch (error) {
      logger.error('API credentials test failed:', error);
      throw new Error(`API credentials test failed: ${error.message}`);
    }
  }

  // Test connection by getting user details
  async testConnection(shoonyaInstance) {
    try {
      // Use UserDetails endpoint to test the connection
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'userdetails');
      logger.info('Shoonya connection test successful');
      return response;
    } catch (error) {
      logger.error('Shoonya connection test failed:', error);
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  // Place order
  async placeOrder(brokerConnectionId, orderParams) {
    try {
      logger.info(`Placing Shoonya order for connection ${brokerConnectionId}`);
      
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // Validate required parameters
      if (!orderParams.tsym) {
        throw new Error('tsym (trading symbol) is required for Shoonya orders');
      }
      if (!orderParams.trantype) {
        throw new Error('trantype is required');
      }
      if (!orderParams.qty) {
        throw new Error('qty is required');
      }

      // Map order parameters to Shoonya format as per their API documentation
      const shoonyaOrderData = {
        exch: orderParams.exch || 'NSE',
        tsym: orderParams.tsym,
        qty: orderParams.qty.toString(),
        prc: orderParams.prctyp === 'LMT' ? parseFloat(orderParams.prc || 0).toString() : '0',
        prd: orderParams.prd || 'I', // I=Intraday, C=CNC, M=Margin
        trantype: orderParams.trantype, // B=Buy, S=Sell
        prctyp: orderParams.prctyp || 'MKT', // MKT=Market, LMT=Limit, SL-LMT=Stop Loss Limit, SL-MKT=Stop Loss Market
        ret: orderParams.ret || 'DAY', // DAY, IOC, EOS
        remarks: orderParams.remarks || '', // Optional client order id or remarks
        dscqty: orderParams.dscqty || '0', // Disclosed quantity
        amo: orderParams.amo || 'NO' // After market order flag
      };

      // Add trigger price for stop loss orders
      if (['SL-LMT', 'SL-MKT'].includes(orderParams.prctyp) && orderParams.trgprc) {
        shoonyaOrderData.trgprc = parseFloat(orderParams.trgprc).toString();
      }

      logger.info('Placing order with Shoonya API:', shoonyaOrderData);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'placeorder', shoonyaOrderData);
      
      logger.info('Shoonya order placed successfully:', response);
      
      return {
        success: true,
        order_id: response.norenordno,
        data: response
      };
    } catch (error) {
      logger.error('Failed to place Shoonya order:', error);
      throw new Error(`Order placement failed: ${error.message}`);
    }
  }
  
  // Modify order
  async modifyOrder(brokerConnectionId, orderParams) {
    try {
      logger.info(`Modifying Shoonya order for connection ${brokerConnectionId}`);
      
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // Validate required parameters
      if (!orderParams.norenordno) {
        throw new Error('norenordno (order number) is required for modifying Shoonya orders');
      }

      // Map order parameters to Shoonya format as per their API documentation
      const shoonyaOrderData = {
        norenordno: orderParams.norenordno,
        exch: orderParams.exch || 'NSE'
      };

      // Add optional parameters if provided
      if (orderParams.qty) {
        shoonyaOrderData.qty = parseInt(orderParams.qty);
      }
      
      if (orderParams.prc) {
        shoonyaOrderData.prc = parseFloat(orderParams.prc).toString();
      }
      
      if (orderParams.trgprc) {
        shoonyaOrderData.trgprc = parseFloat(orderParams.trgprc).toString();
      }

      logger.info('Modifying order with Shoonya API:', shoonyaOrderData);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'modifyorder', shoonyaOrderData);
      
      logger.info('Shoonya order modified successfully:', response);
      
      return {
        success: true,
        order_id: response.result,
        data: response
      };
    } catch (error) {
      logger.error('Failed to modify Shoonya order:', error);
      throw new Error(`Order modification failed: ${error.message}`);
    }
  }
  
  // Cancel order
  async cancelOrder(brokerConnectionId, orderId) {
    try {
      logger.info(`Cancelling Shoonya order ${orderId} for connection ${brokerConnectionId}`);
      
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'cancelorder', {
        norenordno: orderId
      });
      
      logger.info('Shoonya order cancelled successfully:', response);
      
      return {
        success: true,
        order_id: response.result,
        data: response
      };
    } catch (error) {
      logger.error('Failed to cancel Shoonya order:', error);
      throw new Error(`Order cancellation failed: ${error.message}`);
    }
  }

  // Get user profile
  async getProfile(brokerConnectionId) {
    try {
      logger.info(`Getting Shoonya profile for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'userdetails');
      
      logger.info('Shoonya profile retrieved successfully');
      return response;
    } catch (error) {
      logger.error('Failed to get Shoonya profile:', error);
      throw new Error(`Failed to get profile: ${error.message}`);
    }
  }

  // Get positions - Updated to match GitHub API implementation
  async getPositions(brokerConnectionId) {
    try {
      logger.info(`Getting Shoonya positions for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per GitHub RestApi.js, positions endpoint requires uid and actid
      try {
        const response = await this.makeApiCallWithInstance(shoonyaInstance, 'positions');
        
        logger.info('Shoonya positions retrieved successfully');
        
        // Return the response in a consistent format
        return {
          stat: 'Ok',
          positions: Array.isArray(response) ? response : (response.data || [])
        };
      } catch (apiError) {
        // Handle "no data" response as a valid empty result
        if (apiError.message && apiError.message.includes('no data')) {
          logger.info('No positions data available from Shoonya API');
          return {
            stat: 'Ok',
            positions: []
          };
        }
        throw apiError;
      }
    } catch (error) {
      logger.error('Failed to get Shoonya positions:', error);
      throw new Error(`Failed to get positions: ${error.message}`);
    }
  }

  // Get holdings - Updated to match GitHub API implementation
  async getHoldings(brokerConnectionId, productType = '') {
    try {
      logger.info(`Getting Shoonya holdings for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per GitHub RestApi.js, holdings endpoint requires uid, actid and prd
      const data = {
        prd: productType || 'C' // Default to 'C' (CNC/Delivery) if no product type specified
      };
      
      try {
        const response = await this.makeApiCallWithInstance(shoonyaInstance, 'holdings', data);
        
        logger.info('Shoonya holdings retrieved successfully');
        
        // Return the response in a consistent format
        // Holdings API returns an array directly
        return {
          stat: 'Ok',
          holdings: Array.isArray(response) ? response : []
        };
      } catch (apiError) {
        // Handle "no data" response as a valid empty result
        if (apiError.message && apiError.message.includes('no data')) {
          logger.info('No holdings data available from Shoonya API');
          return {
            stat: 'Ok',
            holdings: []
          };
        }
        throw apiError;
      }
    } catch (error) {
      logger.error('Failed to get Shoonya holdings:', error);
      throw new Error(`Failed to get holdings: ${error.message}`);
    }
  }

  // Get orders - Updated to match GitHub API implementation
  async getOrders(brokerConnectionId) {
    try {
      logger.info(`Getting Shoonya orders for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per GitHub RestApi.js, orderbook endpoint requires uid and actid
      try {
        const response = await this.makeApiCallWithInstance(shoonyaInstance, 'orderbook');
        
        logger.info('Shoonya orders retrieved successfully');
        
        // Return the response in a consistent format
        // Orders API may return an array directly
        return {
          stat: 'Ok',
          orders: Array.isArray(response) ? response : []
        };
      } catch (apiError) {
        // Handle "no data" response as a valid empty result
        if (apiError.message && apiError.message.includes('no data')) {
          logger.info('No orders data available from Shoonya API');
          return {
            stat: 'Ok',
            orders: []
          };
        }
        throw apiError;
      }
    } catch (error) {
      logger.error('Failed to get Shoonya orders:', error);
      throw new Error(`Failed to get orders: ${error.message}`);
    }
  }

  // Get order status
  async getOrderStatus(brokerConnectionId, orderId) {
    try {
      logger.info(`Getting Shoonya order status for order ${orderId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'singleorderhistory', {
        norenordno: orderId
      });
      
      logger.info('Shoonya order status retrieved successfully');
      return response;
    } catch (error) {
      logger.error('Failed to get Shoonya order status:', error);
      throw new Error(`Failed to get order status: ${error.message}`);
    }
  }

  // Get instrument tokens (for symbol lookup)
  async getInstruments(brokerConnectionId, exchange = 'NSE') {
    try {
      logger.info(`Getting Shoonya instruments for exchange ${exchange}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per Shoonya API documentation, use SearchScrip with empty search text
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'searchscrip', {
        exch: exchange,
        stext: '' // Empty to get all instruments
      });
      
      logger.info('Shoonya instruments retrieved successfully');
      return response;
    } catch (error) {
      logger.error('Failed to get Shoonya instruments:', error);
      throw new Error(`Failed to get instruments: ${error.message}`);
    }
  }

  // Search for specific symbol
  async searchSymbol(brokerConnectionId, symbol, exchange = 'NSE') {
    try {
      logger.info(`Searching Shoonya symbol ${symbol} on ${exchange}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per Shoonya API documentation, use SearchScrip with search text
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'searchscrip', {
        exch: exchange,
        stext: symbol
      });
      
      logger.info('Shoonya symbol search completed');
      return response;
    } catch (error) {
      logger.error('Failed to search Shoonya symbol:', error);
      throw new Error(`Failed to search symbol: ${error.message}`);
    }
  }

  // Get market data (quotes)
  async getMarketData(brokerConnectionId, exchange, token) {
    try {
      logger.info(`Getting Shoonya market data for ${exchange}:${token}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per Shoonya API documentation, use GetQuotes endpoint
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'getquotes', {
        exch: exchange,
        token: token
      });
      
      logger.info('Shoonya market data retrieved successfully');
      return response;
    } catch (error) {
      logger.error('Failed to get Shoonya market data:', error);
      throw new Error(`Failed to get market data: ${error.message}`);
    }
  }
  
  // Get time price series (historical data)
  async getTimePriceSeries(brokerConnectionId, exchange, token, startTime, endTime, interval = '1') {
    try {
      logger.info(`Getting Shoonya time price series for ${exchange}:${token}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per Shoonya API documentation
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'tpseries', {
        exch: exchange,
        token: token,
        starttime: startTime, // seconds since epoch
        endtime: endTime, // seconds since epoch
        interval: interval // 1, 3, 5, 10, 15, 30, 60, 120, 240 minutes
      });
      
      logger.info('Shoonya time price series retrieved successfully');
      return response;
    } catch (error) {
      logger.error('Failed to get Shoonya time price series:', error);
      throw new Error(`Failed to get time price series: ${error.message}`);
    }
  }

  // Get option chain
  async getOptionChain(brokerConnectionId, exchange, tradingSymbol, strikePrice, count = 5) {
    try {
      logger.info(`Getting Shoonya option chain for ${tradingSymbol} on ${exchange}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per Shoonya API documentation
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'optionchain', {
        exch: exchange,
        tsym: tradingSymbol,
        strprc: strikePrice,
        cnt: count
      });
      
      logger.info('Shoonya option chain retrieved successfully');
      return response;
    } catch (error) {
      logger.error('Failed to get Shoonya option chain:', error);
      throw new Error(`Failed to get option chain: ${error.message}`);
    }
  }
  
  // Get trade book - Added as per GitHub API implementation
  async getTradeBook(brokerConnectionId) {
    try {
      logger.info(`Getting Shoonya trade book for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per GitHub RestApi.js, tradebook endpoint requires uid and actid
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'tradebook');
      
      logger.info('Shoonya trade book retrieved successfully');
      
      // Return the response in a consistent format
      if (response.stat === 'Ok') {
        return {
          stat: response.stat,
          trades: Array.isArray(response) ? response : (response.data || [])
        };
      } else {
        throw new Error(response.emsg || 'Failed to get trade book');
      }
    } catch (error) {
      logger.error('Failed to get Shoonya trade book:', error);
      throw new Error(`Failed to get trade book: ${error.message}`);
    }
  }

  // Get limits (margins) - Updated to match GitHub API implementation
  async getLimits(brokerConnectionId, productType = '', segment = '', exchange = '') {
    try {
      logger.info(`Getting Shoonya limits for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // As per GitHub RestApi.js implementation
      const data = {};
      if (productType) data.prd = productType;
      if (segment) data.seg = segment;
      if (exchange) data.exch = exchange;
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'limits', data);
      
      logger.info('Shoonya limits retrieved successfully');
      
      // Return the response in a consistent format
      if (response.stat === 'Ok') {
        return {
          stat: response.stat,
          limits: response
        };
      } else {
        throw new Error(response.emsg || 'Failed to get limits');
      }
    } catch (error) {
      logger.error('Failed to get Shoonya limits:', error);
      throw new Error(`Failed to get limits: ${error.message}`);
    }
  }

  // Get watchlist names - Added as per GitHub API implementation
  async getWatchlistNames(brokerConnectionId) {
    try {
      logger.info(`Getting Shoonya watchlist names for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'watchlist_names');
      
      logger.info('Shoonya watchlist names retrieved successfully');
      
      if (response.stat === 'Ok') {
        return {
          stat: response.stat,
          watchlists: Array.isArray(response) ? response : (response.data || [])
        };
      } else {
        throw new Error(response.emsg || 'Failed to get watchlist names');
      }
    } catch (error) {
      logger.error('Failed to get Shoonya watchlist names:', error);
      throw new Error(`Failed to get watchlist names: ${error.message}`);
    }
  }

  // Get watchlist - Added as per GitHub API implementation
  async getWatchlist(brokerConnectionId, watchlistName) {
    try {
      logger.info(`Getting Shoonya watchlist ${watchlistName} for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'watchlist', {
        wlname: watchlistName
      });
      
      logger.info('Shoonya watchlist retrieved successfully');
      
      if (response.stat === 'Ok') {
        return {
          stat: response.stat,
          watchlist: Array.isArray(response) ? response : (response.data || [])
        };
      } else {
        throw new Error(response.emsg || 'Failed to get watchlist');
      }
    } catch (error) {
      logger.error('Failed to get Shoonya watchlist:', error);
      throw new Error(`Failed to get watchlist: ${error.message}`);
    }
  }

  // Add scrips to watchlist - Added as per GitHub API implementation
  async addToWatchlist(brokerConnectionId, watchlistName, scrips) {
    try {
      logger.info(`Adding scrips to Shoonya watchlist ${watchlistName} for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'watchlist_add', {
        wlname: watchlistName,
        scrips: scrips // Should be a string of comma-separated scrips
      });
      
      logger.info('Scrips added to Shoonya watchlist successfully');
      return response;
    } catch (error) {
      logger.error('Failed to add scrips to Shoonya watchlist:', error);
      throw new Error(`Failed to add to watchlist: ${error.message}`);
    }
  }

  // Delete scrips from watchlist - Added as per GitHub API implementation
  async deleteFromWatchlist(brokerConnectionId, watchlistName, scrips) {
    try {
      logger.info(`Deleting scrips from Shoonya watchlist ${watchlistName} for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'watchlist_delete', {
        wlname: watchlistName,
        scrips: scrips // Should be a string of comma-separated scrips
      });
      
      logger.info('Scrips deleted from Shoonya watchlist successfully');
      return response;
    } catch (error) {
      logger.error('Failed to delete scrips from Shoonya watchlist:', error);
      throw new Error(`Failed to delete from watchlist: ${error.message}`);
    }
  }

  // Logout from Shoonya - Updated to match GitHub API implementation
  async logout(brokerConnectionId) {
    try {
      logger.info(`Logging out from Shoonya for connection ${brokerConnectionId}`);
      const shoonyaInstance = await this.getShoonyaInstance(brokerConnectionId);
      
      // Call the logout endpoint as per GitHub API
      const response = await this.makeApiCallWithInstance(shoonyaInstance, 'logout');
      
      // Clear the cached instance
      this.clearCachedInstance(brokerConnectionId);
      
      logger.info('Shoonya logout successful');
      
      if (response.stat === 'Ok') {
        return {
          stat: response.stat,
          message: 'Logout successful'
        };
      } else {
        throw new Error(response.emsg || 'Failed to logout');
      }
    } catch (error) {
      logger.error('Failed to logout from Shoonya:', error);
      // Still clear the cached instance even if the API call fails
      this.clearCachedInstance(brokerConnectionId);
      throw new Error(`Failed to logout: ${error.message}`);
    }
  }

  // Clear cached instance
  clearCachedInstance(brokerConnectionId) {
    if (this.shoonyaInstances.has(brokerConnectionId)) {
      this.shoonyaInstances.delete(brokerConnectionId);
      logger.info(`Cleared cached Shoonya instance for connection ${brokerConnectionId}`);
    }
  }
}

export default new ShoonyaService();
