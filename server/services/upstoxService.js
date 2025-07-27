import axios from 'axios';
import { db } from '../database/init.js';
import { encryptData, decryptData } from '../utils/encryption.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('UpstoxService');

class UpstoxService {
  constructor() {
    this.upstoxInstances = new Map(); // Store Upstox instances per connection
    this.baseURL = 'https://api.upstox.com/v2';
    this.instrumentsCache = new Map(); // Cache instruments data
    this.instrumentsCacheExpiry = null;
    
    // Fallback mapping for common symbols (NSE_EQ)
    this.fallbackInstrumentMapping = new Map([
      ['NSE_EQ:RELIANCE', 'NSE_EQ|INE002A01018'],
      ['NSE_EQ:TCS', 'NSE_EQ|INE467B01029'],
      ['NSE_EQ:HDFCBANK', 'NSE_EQ|INE040A01034'],
      ['NSE_EQ:INFY', 'NSE_EQ|INE009A01021'],
      ['NSE_EQ:ICICIBANK', 'NSE_EQ|INE090A01021'],
      ['NSE_EQ:HINDUNILVR', 'NSE_EQ|INE030A01027'],
      ['NSE_EQ:SBIN', 'NSE_EQ|INE062A01020'],
      ['NSE_EQ:BHARTIARTL', 'NSE_EQ|INE397D01024'],
      ['NSE_EQ:ITC', 'NSE_EQ|INE154A01025'],
      ['NSE_EQ:KOTAKBANK', 'NSE_EQ|INE237A01028'],
      ['NSE_EQ:LT', 'NSE_EQ|INE018A01030'],
      ['NSE_EQ:AXISBANK', 'NSE_EQ|INE238A01034'],
      ['NSE_EQ:MARUTI', 'NSE_EQ|INE585B01010'],
      ['NSE_EQ:SUNPHARMA', 'NSE_EQ|INE044A01036'],
      ['NSE_EQ:ULTRACEMCO', 'NSE_EQ|INE481G01011'],
      ['NSE_EQ:ASIANPAINT', 'NSE_EQ|INE021A01026'],
      ['NSE_EQ:NESTLEIND', 'NSE_EQ|INE239A01016'],
      ['NSE_EQ:TITAN', 'NSE_EQ|INE280A01028'],
      ['NSE_EQ:BAJFINANCE', 'NSE_EQ|INE296A01024'],
      ['NSE_EQ:POWERGRID', 'NSE_EQ|INE752E01010']
    ]);
  }

  // Generate access token from authorization code
  async generateAccessToken(apiKey, apiSecret, authorizationCode, redirectUri) {
    try {
      logger.info('Generating Upstox access token', {
        apiKeyLength: apiKey ? apiKey.length : 0,
        apiSecretProvided: !!apiSecret,
        authCodeProvided: !!authorizationCode,
        redirectUri: redirectUri
      });
      
      const tokenUrl = `${this.baseURL}/login/authorization/token`;
      
      // Log the exact values being sent (masked for security)
      const maskedApiKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'undefined';
      const maskedApiSecret = apiSecret ? '********' : 'undefined';
      const maskedAuthCode = authorizationCode ? `${authorizationCode.substring(0, 4)}...` : 'undefined';
      
      logger.info('Upstox authentication parameters', {
        maskedApiKey,
        maskedAuthCode,
        redirectUri,
        tokenUrl
      });
      
      // Prepare form data for token request
      const formData = new URLSearchParams({
        code: authorizationCode,
        client_id: apiKey,
        client_secret: apiSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });

      // Log the exact request being sent
      logger.info('Upstox token request details', {
        url: tokenUrl,
        client_id: maskedApiKey,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        hasCode: !!authorizationCode,
        hasSecret: !!apiSecret,
        formDataString: formData.toString().replace(/(client_secret|code)=[^&]+/g, '$1=REDACTED')
      });

      // Also log to console for immediate visibility
      console.log('🔐 Token request data:', {
        url: tokenUrl,
        client_id: maskedApiKey,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        hasCode: !!authorizationCode,
        hasSecret: !!apiSecret
      });

      const response = await axios.post(tokenUrl, formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'AutoTraderHub/1.0'
        },
        timeout: 30000 // 30 second timeout
      });

      logger.info('Upstox token response received', {
        status: response.status,
        statusText: response.statusText,
        hasAccessToken: !!response.data?.access_token,
        hasRefreshToken: !!response.data?.refresh_token,
        expiresIn: response.data?.expires_in
      });

      console.log('✅ Upstox token response status:', response.status);
      console.log('✅ Upstox token response data:', response.data);

      logger.info('Upstox access token generated successfully');
      return response.data;
    } catch (error) {
      // Enhanced error logging
      const errorDetails = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        stack: error.stack
      };
      
      logger.error('Failed to generate Upstox access token', errorDetails);
      
      // Log the full error response for debugging
      if (error.response?.data) {
        logger.error('Upstox error response data', { 
          responseData: JSON.stringify(error.response.data),
          headers: error.response.headers
        });
      }
      
      console.error('❌ Upstox token generation failed:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          error.response?.data?.error_description ||
                          error.message;
      
      throw new Error(`Failed to generate access token: ${errorMessage}`);
    }
  }

  // Refresh access token using refresh token
  async refreshAccessToken(brokerConnectionId) {
    try {
      logger.info(`Refreshing Upstox access token for connection ${brokerConnectionId}`);
      
      const connection = await db.getAsync(
        'SELECT * FROM broker_connections WHERE id = ? AND is_active = 1',
        [brokerConnectionId]
      );

      if (!connection || !connection.refresh_token) {
        throw new Error('Connection not found or refresh token not available');
      }

      const apiKey = decryptData(connection.api_key);
      const apiSecret = decryptData(connection.encrypted_api_secret);
      const refreshToken = decryptData(connection.refresh_token);

      const tokenUrl = `${this.baseURL}/login/authorization/token`;
      
      const formData = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: apiKey,
        client_secret: apiSecret,
        grant_type: 'refresh_token'
      });

      const response = await axios.post(tokenUrl, formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 30000
      });

      if (response.data && response.data.access_token) {
        logger.info('Upstox access token refreshed successfully');
        return response.data;
      } else {
        throw new Error('Invalid refresh response');
      }

    } catch (error) {
      logger.error('Failed to refresh Upstox access token:', error);
      
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          error.message;
      
      throw new Error(`Token refresh failed: ${errorMessage}`);
    }
  }

  // Initialize Upstox instance for a connection
  async initializeUpstox(brokerConnection) {
    try {
      logger.info(`Initializing Upstox instance for connection ${brokerConnection.id}`);

      if (!brokerConnection.api_key) {
        throw new Error('API key is missing from broker connection');
      }

      if (!brokerConnection.access_token) {
        throw new Error('Access token is missing from broker connection');
      }

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (brokerConnection.access_token_expires_at && brokerConnection.access_token_expires_at < now) {
        throw new Error('Access token has expired. Please refresh your token.');
      }

      const apiKey = decryptData(brokerConnection.api_key);
      const accessToken = decryptData(brokerConnection.access_token);

      const upstoxInstance = {
        apiKey,
        accessToken,
        baseURL: this.baseURL,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      // Test the connection
      await this.testConnection(upstoxInstance);

      this.upstoxInstances.set(brokerConnection.id, upstoxInstance);
      logger.info(`Upstox instance initialized for connection ${brokerConnection.id}`);
      
      return upstoxInstance;
    } catch (error) {
      logger.error('Failed to initialize Upstox instance:', error);
      throw new Error(`Failed to initialize Upstox connection: ${error.message}`);
    }
  }

  // Get or create Upstox instance
  async getUpstoxInstance(brokerConnectionId) {
    logger.info(`Getting Upstox instance for connection ${brokerConnectionId}`);
    
    if (this.upstoxInstances.has(brokerConnectionId)) {
      logger.info('Using cached Upstox instance');
      return this.upstoxInstances.get(brokerConnectionId);
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

    logger.info('Broker connection found, initializing Upstox');
    return await this.initializeUpstox(brokerConnection);
  }

  // Test connection
  async testConnection(upstoxInstance) {
    try {
      const response = await axios.get(`${upstoxInstance.baseURL}/user/profile`, {
        headers: upstoxInstance.headers
      });
      
      logger.info('Upstox connection test successful');
      return response.data;
    } catch (error) {
      logger.error('Upstox connection test failed:', error);
      throw new Error(`Connection test failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Handle 401 errors by refreshing token
  async handleAuthError(brokerConnectionId, originalError) {
    try {
      logger.info(`Handling 401 error for connection ${brokerConnectionId}, attempting token refresh`);
      
      // Remove cached instance
      this.upstoxInstances.delete(brokerConnectionId);
      
      // Try to refresh the token
      const refreshedTokenData = await this.refreshAccessToken(brokerConnectionId);
      
      if (refreshedTokenData && refreshedTokenData.access_token) {
        // Update the database with new token
        const encryptedAccessToken = encryptData(refreshedTokenData.access_token);
        const expiresAt = Math.floor(Date.now() / 1000) + (refreshedTokenData.expires_in || 3600);
        
        await db.runAsync(
          'UPDATE broker_connections SET access_token = ?, access_token_expires_at = ? WHERE id = ?',
          [encryptedAccessToken, expiresAt, brokerConnectionId]
        );
        
        logger.info('Token refreshed successfully, reinitializing connection');
        
        // Get fresh connection data and reinitialize
        const brokerConnection = await db.getAsync(
          'SELECT * FROM broker_connections WHERE id = ? AND is_active = 1',
          [brokerConnectionId]
        );
        
        return await this.initializeUpstox(brokerConnection);
      } else {
        throw new Error('Token refresh failed - no access token received');
      }
      
    } catch (refreshError) {
      logger.error('Failed to refresh token:', refreshError);
      throw new Error(`Authentication failed and token refresh failed: ${refreshError.message}`);
    }
  }

  // Fetch and cache instruments data
  async fetchInstruments(upstoxInstance, brokerConnectionId = null) {
    try {
      // Check if cache is still valid (cache for 1 hour)
      const now = Date.now();
      if (this.instrumentsCacheExpiry && now < this.instrumentsCacheExpiry) {
        logger.info('Using cached instruments data');
        return this.instrumentsCache;
      }

      logger.info('Fetching instruments data from Upstox API');
      
      const response = await axios.get(`${upstoxInstance.baseURL}/instruments`, {
        headers: upstoxInstance.headers
      });

      // Handle JSON response
      const instrumentsData = response.data.data || response.data;
      
      // Clear existing cache
      this.instrumentsCache.clear();
      
      // Process each instrument
      if (Array.isArray(instrumentsData)) {
        for (const instrument of instrumentsData) {
          // Create mapping key: EXCHANGE:SYMBOL (e.g., NSE_EQ:RELIANCE)
          const key = `${instrument.exchange}:${instrument.trading_symbol}`;
          this.instrumentsCache.set(key, {
            instrument_token: instrument.instrument_key,
            trading_symbol: instrument.trading_symbol,
            name: instrument.name,
            exchange: instrument.exchange,
            segment: instrument.segment,
            instrument_type: instrument.instrument_type
          });
        }
      }
      
      // Set cache expiry to 1 hour from now
      this.instrumentsCacheExpiry = now + (60 * 60 * 1000);
      
      logger.info(`Cached ${this.instrumentsCache.size} instruments`);
      return this.instrumentsCache;
      
    } catch (error) {
      // If 401 error and we have brokerConnectionId, try to refresh token
      if (error.response?.status === 401 && brokerConnectionId) {
        logger.warn('Got 401 error while fetching instruments, attempting token refresh');
        try {
          const refreshedInstance = await this.handleAuthError(brokerConnectionId, error);
          // Retry with refreshed token
          return await this.fetchInstruments(refreshedInstance, brokerConnectionId);
        } catch (refreshError) {
          logger.error('Token refresh failed, falling back to error:', refreshError);
        }
      }
      
      logger.error('Failed to fetch instruments data:', error);
      throw new Error(`Failed to fetch instruments: ${error.response?.data?.message || error.message}`);
    }
  }

  // Convert symbol to instrument token
  async getInstrumentToken(upstoxInstance, symbol, exchange = 'NSE_EQ', brokerConnectionId = null) {
    try {
      // First try to fetch from API
      try {
        await this.fetchInstruments(upstoxInstance, brokerConnectionId);
        
        // Try different key formats
        const possibleKeys = [
          `${exchange}:${symbol}`,
          `NSE_EQ:${symbol}`,
          `BSE_EQ:${symbol}`,
          `NSE_FO:${symbol}`,
          `MCX_FO:${symbol}`
        ];
        
        for (const key of possibleKeys) {
          const instrument = this.instrumentsCache.get(key);
          if (instrument) {
            logger.info(`Found instrument token for ${symbol}: ${instrument.instrument_token}`);
            return instrument.instrument_token;
          }
        }
      } catch (apiError) {
        logger.warn('Failed to fetch instruments from API, trying fallback mapping:', apiError.message);
      }
      
      // Fallback to hardcoded mapping for common symbols
      const possibleKeys = [
        `${exchange}:${symbol}`,
        `NSE_EQ:${symbol}`,
        `BSE_EQ:${symbol}`
      ];
      
      for (const key of possibleKeys) {
        const instrumentToken = this.fallbackInstrumentMapping.get(key);
        if (instrumentToken) {
          logger.info(`Found instrument token from fallback mapping for ${symbol}: ${instrumentToken}`);
          return instrumentToken;
        }
      }
      
      // If not found in either API or fallback, log error
      logger.error(`Instrument token not found for symbol: ${symbol}`);
      logger.error('Available fallback instruments:', 
        Array.from(this.fallbackInstrumentMapping.keys()).slice(0, 10)
      );
      
      throw new Error(`Instrument token not found for symbol: ${symbol}. Please ensure the symbol is correct or add it to the fallback mapping.`);
      
    } catch (error) {
      logger.error('Failed to get instrument token:', error);
      throw error;
    }
  }

  // Place order
  async placeOrder(brokerConnectionId, orderParams) {
    try {
      logger.info(`Placing Upstox order for connection ${brokerConnectionId}`);
      
      const upstoxInstance = await this.getUpstoxInstance(brokerConnectionId);
      
      // Validate required parameters
      if (!orderParams.instrument_token) {
        throw new Error('instrument_token is required for Upstox orders');
      }
      if (!orderParams.transaction_type) {
        throw new Error('transaction_type is required');
      }
      if (!orderParams.quantity) {
        throw new Error('quantity is required');
      }

      // Convert symbol to instrument token if needed
      let instrumentToken = orderParams.instrument_token;
      
      // Check if instrument_token is a symbol (non-numeric) and needs conversion
      if (isNaN(instrumentToken)) {
        logger.info(`Converting symbol ${instrumentToken} to instrument token`);
        try {
          instrumentToken = await this.getInstrumentToken(upstoxInstance, instrumentToken, orderParams.exchange, brokerConnectionId);
        } catch (error) {
          logger.error(`Failed to convert symbol ${instrumentToken} to instrument token:`, error);
          throw new Error(`Invalid instrument: ${instrumentToken}. Unable to find instrument token.`);
        }
      }

      // Map order parameters to Upstox format
      const upstoxOrderData = {
        quantity: parseInt(orderParams.quantity),
        product: orderParams.product || 'I', // I = Intraday, D = Delivery, CO = Cover Order, OCO = One Cancels Other
        validity: orderParams.validity || 'DAY',
        price: orderParams.order_type === 'LIMIT' ? parseFloat(orderParams.price || 0) : 0,
        tag: orderParams.tag || 'AutoTraderHub',
        instrument_token: instrumentToken,
        order_type: orderParams.order_type || 'MARKET',
        transaction_type: orderParams.transaction_type,
        disclosed_quantity: orderParams.disclosed_quantity || 0,
        trigger_price: ['SL', 'SL-M'].includes(orderParams.order_type) ? parseFloat(orderParams.trigger_price || 0) : 0,
        is_amo: orderParams.is_amo || false
      };

      logger.info('Placing order with Upstox API:', upstoxOrderData);
      
      const response = await axios.post(
        `${upstoxInstance.baseURL}/order/place`,
        upstoxOrderData,
        { headers: upstoxInstance.headers }
      );

      logger.info('Upstox order placed successfully:', response.data);
      
      return {
        success: true,
        order_id: response.data.data.order_id,
        data: response.data.data
      };
    } catch (error) {
      logger.error('Failed to place Upstox order:', error);
      
      // Log detailed error information for debugging
      if (error.response) {
        logger.error('Upstox API error response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers
        });
      }
      
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          error.response?.data?.errors?.[0]?.message ||
                          error.message;
      
      throw new Error(`Order placement failed: ${errorMessage}`);
    }
  }

  // Get user profile
  async getProfile(brokerConnectionId) {
    try {
      logger.info(`Getting Upstox profile for connection ${brokerConnectionId}`);
      const upstoxInstance = await this.getUpstoxInstance(brokerConnectionId);
      
      const response = await axios.get(`${upstoxInstance.baseURL}/user/profile`, {
        headers: upstoxInstance.headers
      });
      
      logger.info('Upstox profile retrieved successfully');
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Upstox profile:', error);
      throw new Error(`Failed to get profile: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get positions
  async getPositions(brokerConnectionId) {
    try {
      logger.info(`Getting Upstox positions for connection ${brokerConnectionId}`);
      const upstoxInstance = await this.getUpstoxInstance(brokerConnectionId);
      
      const response = await axios.get(`${upstoxInstance.baseURL}/portfolio/short-term-positions`, {
        headers: upstoxInstance.headers
      });
      
      logger.info('Upstox positions retrieved successfully');
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Upstox positions:', error);
      throw new Error(`Failed to get positions: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get holdings
  async getHoldings(brokerConnectionId) {
    try {
      logger.info(`Getting Upstox holdings for connection ${brokerConnectionId}`);
      const upstoxInstance = await this.getUpstoxInstance(brokerConnectionId);
      
      const response = await axios.get(`${upstoxInstance.baseURL}/portfolio/long-term-holdings`, {
        headers: upstoxInstance.headers
      });
      
      logger.info('Upstox holdings retrieved successfully');
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Upstox holdings:', error);
      throw new Error(`Failed to get holdings: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get orders
  async getOrders(brokerConnectionId) {
    try {
      logger.info(`Getting Upstox orders for connection ${brokerConnectionId}`);
      const upstoxInstance = await this.getUpstoxInstance(brokerConnectionId);
      
      const response = await axios.get(`${upstoxInstance.baseURL}/order/retrieve-all`, {
        headers: upstoxInstance.headers
      });
      
      logger.info('Upstox orders retrieved successfully');
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Upstox orders:', error);
      throw new Error(`Failed to get orders: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get order status
  async getOrderStatus(brokerConnectionId, orderId) {
    try {
      logger.info(`Getting Upstox order status for order ${orderId}`);
      const upstoxInstance = await this.getUpstoxInstance(brokerConnectionId);
      
      const response = await axios.get(`${upstoxInstance.baseURL}/order/details?order_id=${orderId}`, {
        headers: upstoxInstance.headers
      });
      
      logger.info('Upstox order status retrieved successfully');
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Upstox order status:', error);
      throw new Error(`Failed to get order status: ${error.response?.data?.message || error.message}`);
    }
  }



  // Clear cached instance
  clearCachedInstance(brokerConnectionId) {
    try {
      if (this.upstoxInstances.has(brokerConnectionId)) {
        this.upstoxInstances.delete(brokerConnectionId);
        logger.info(`Cleared cached Upstox instance for connection ${brokerConnectionId}`);
        console.log(`🗑️ Cleared cached Upstox instance for connection ${brokerConnectionId}`);
        return true;
      } else {
        logger.info(`No cached Upstox instance found for connection ${brokerConnectionId}`);
        console.log(`ℹ️ No cached Upstox instance found for connection ${brokerConnectionId}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error clearing cached Upstox instance: ${error.message}`);
      console.error(`❌ Error clearing cached Upstox instance: ${error.message}`);
      return false;
    }
  }
}

// Utility function to check Upstox API status
async function checkUpstoxApiStatus() {
  const upstoxService = new UpstoxService();
  try {
    const response = await axios.get(`${upstoxService.baseURL}/status`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'AutoTraderHub/1.0'
      },
      timeout: 10000
    });
    
    return {
      status: 'success',
      apiStatus: response.data,
      statusCode: response.status,
      message: 'Upstox API is available'
    };
  } catch (error) {
    return {
      status: 'error',
      statusCode: error.response?.status,
      message: error.message,
      error: error.response?.data || error.message
    };
  }
}

const upstoxServiceInstance = new UpstoxService();
export { checkUpstoxApiStatus };
export default upstoxServiceInstance;