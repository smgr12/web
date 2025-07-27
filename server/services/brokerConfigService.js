import { createLogger } from '../utils/logger.js';

const logger = createLogger('BROKER_CONFIG_SERVICE');

class BrokerConfigService {
  constructor() {
    this.brokerConfigs = {
      zerodha: {
        name: 'Zerodha',
        authMethod: 'oauth',
        requiredFields: ['api_key', 'api_secret'],
        optionalFields: ['user_id_broker'],
        authUrl: 'https://kite.trade/connect/login',
        baseUrl: 'https://api.kite.trade',
        webhookFormat: 'zerodha',
        orderFields: {
          required: ['tradingsymbol', 'exchange', 'transaction_type', 'quantity', 'order_type', 'product'],
          optional: ['price', 'trigger_price', 'validity', 'disclosed_quantity', 'tag']
        }
      },
      upstox: {
        name: 'Upstox',
        authMethod: 'oauth',
        requiredFields: ['api_key', 'api_secret', 'redirect_uri'],
        optionalFields: [],
        authUrl: 'https://api.upstox.com/v2/login/authorization/dialog',
        baseUrl: 'https://api.upstox.com/v2',
        webhookFormat: 'upstox',
        orderFields: {
          required: ['instrument_token', 'quantity', 'product', 'validity', 'price', 'order_type', 'transaction_type'],
          optional: ['disclosed_quantity', 'trigger_price', 'is_amo', 'tag']
        }
      },
      angel: {
        name: 'Angel Broking',
        authMethod: 'manual',
        requiredFields: ['api_key', 'client_code', 'password', 'pin'],
        optionalFields: ['two_fa'],
        authUrl: null,
        baseUrl: 'https://apiconnect.angelbroking.com',
        webhookFormat: 'angel',
        orderFields: {
          required: ['variety', 'tradingsymbol', 'symboltoken', 'transactiontype', 'exchange', 'ordertype', 'producttype', 'duration', 'quantity'],
          optional: ['price', 'squareoff', 'stoploss']
        }
      },
      shoonya: {
        name: 'Shoonya',
        authMethod: 'manual',
        requiredFields: ['api_key', 'user_id_broker', 'vendor_code', 'imei'],
        optionalFields: ['api_secret'],
        authUrl: null,
        baseUrl: 'https://api.shoonya.com',
        webhookFormat: 'shoonya',
        orderFields: {
          required: ['uid', 'actid', 'exch', 'tsym', 'qty', 'prc', 'prd', 'trantype', 'prctyp', 'ret'],
          optional: ['trgprc', 'ordersource']
        }
      },
      '5paisa': {
        name: '5Paisa',
        authMethod: 'oauth',
        requiredFields: ['api_key', 'api_secret', 'app_key'],
        optionalFields: ['user_id_broker'],
        authUrl: 'https://dev-openapi.5paisa.com/WebVendorLogin/VLogin/Index',
        baseUrl: 'https://Openapi.5paisa.com/VendorAPI',
        webhookFormat: '5paisa',
        orderFields: {
          required: ['Exchange', 'ExchangeType', 'Symbol', 'Qty', 'Price', 'OrderType', 'BuySell'],
          optional: ['DisQty', 'IsStopLossOrder', 'StopLossPrice', 'IsVTD', 'IOCOrder', 'IsIntraday']
        }
      }
    };
  }

  getBrokerConfig(brokerName) {
    const config = this.brokerConfigs[brokerName.toLowerCase()];
    if (!config) {
      throw new Error(`Unsupported broker: ${brokerName}`);
    }
    return config;
  }

  getAllBrokers() {
    return Object.keys(this.brokerConfigs).map(key => ({
      id: key,
      ...this.brokerConfigs[key]
    }));
  }

  getRequiredFields(brokerName) {
    const config = this.getBrokerConfig(brokerName);
    return config.requiredFields;
  }

  getOptionalFields(brokerName) {
    const config = this.getBrokerConfig(brokerName);
    return config.optionalFields;
  }

  getOrderFields(brokerName) {
    const config = this.getBrokerConfig(brokerName);
    return config.orderFields;
  }

  getWebhookFormat(brokerName) {
    const config = this.getBrokerConfig(brokerName);
    return config.webhookFormat;
  }

  validateBrokerData(brokerName, data, isInitialConnection = false) {
    const config = this.getBrokerConfig(brokerName);
    const errors = [];

    // For manual auth brokers (Angel, Shoonya), password and two_fa are collected in the second step
    let fieldsToValidate = config.requiredFields;
    
    if (isInitialConnection && config.authMethod === 'manual') {
      // For initial connection, don't validate password and two_fa for manual auth brokers
      fieldsToValidate = config.requiredFields.filter(field => 
        !['password', 'two_fa', 'pin'].includes(field)
      );
    }

    // Check required fields
    for (const field of fieldsToValidate) {
      if (!data[field] || data[field].trim() === '') {
        errors.push(`${field} is required for ${config.name}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  generateWebhookSyntax(brokerName, orderData = {}) {
    const config = this.getBrokerConfig(brokerName);
    const orderFields = config.orderFields;
    
    const syntax = {
      broker: config.name,
      format: config.webhookFormat,
      required_fields: orderFields.required,
      optional_fields: orderFields.optional,
      example: this.generateExamplePayload(brokerName, orderData)
    };

    return syntax;
  }

  generateExamplePayload(brokerName, customData = {}) {
    const config = this.getBrokerConfig(brokerName);
    
    const examples = {
      zerodha: {
        symbol: customData.symbol || "RELIANCE",
        action: customData.action || "BUY",
        quantity: customData.quantity || 1,
        order_type: customData.order_type || "MARKET",
        product: customData.product || "MIS",
        exchange: customData.exchange || "NSE",
        validity: customData.validity || "DAY",
        price: customData.price || 0,
        trigger_price: customData.trigger_price || 0,
        tag: customData.tag || "TradingView"
      },
      upstox: {
        symbol: customData.symbol || "RELIANCE",
        action: customData.action || "BUY",
        quantity: customData.quantity || 1,
        order_type: customData.order_type || "MARKET",
        product: customData.product || "I",
        exchange: customData.exchange || "NSE_EQ",
        validity: customData.validity || "DAY",
        price: customData.price || 0,
        trigger_price: customData.trigger_price || 0,
        disclosed_quantity: customData.disclosed_quantity || 0,
        is_amo: customData.is_amo || false,
        tag: customData.tag || "TradingView"
      },
      angel: {
        symbol: customData.symbol || "RELIANCE-EQ",
        symboltoken: customData.symboltoken || "2885",
        action: customData.action || "BUY",
        quantity: customData.quantity || 1,
        order_type: customData.order_type || "MARKET",
        product: customData.product || "INTRADAY",
        exchange: customData.exchange || "NSE",
        validity: customData.validity || "DAY",
        price: customData.price || "0",
        squareoff: customData.squareoff || "0",
        stoploss: customData.stoploss || "0"
      },
      shoonya: {
        symbol: customData.symbol || "RELIANCE",
        action: customData.action || "BUY",
        quantity: customData.quantity || 1,
        order_type: customData.order_type || "MKT",
        product: customData.product || "I",
        exchange: customData.exchange || "NSE",
        validity: customData.validity || "DAY",
        price: customData.price || "0",
        trigger_price: customData.trigger_price || "0"
      },
      '5paisa': {
        symbol: customData.symbol || "RELIANCE",
        action: customData.action || "BUY",
        quantity: customData.quantity || 1,
        order_type: customData.order_type || "MARKET",
        exchange: customData.exchange || "N",
        price: customData.price || 0,
        disclosed_quantity: customData.disclosed_quantity || 0,
        is_intraday: customData.is_intraday || true
      }
    };

    return examples[brokerName.toLowerCase()] || {};
  }

  getWebhookUrl(userId, connectionId) {
    const baseUrl = process.env.WEBHOOK_BASE_URL || 'http://localhost:3001';
    return `${baseUrl}/api/webhook/${userId}/${connectionId}`;
  }
}

export default new BrokerConfigService();
