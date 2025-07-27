import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Code, Copy, CheckCircle, Download, RefreshCw, Settings, 
  Zap, AlertCircle, BookOpen, ExternalLink, Play, FileText,
  Webhook, Database, Shield, Search
} from 'lucide-react';
import { brokerAPI, symbolsAPI } from '../../services/api';
import SymbolSearch from './SymbolSearch';
import toast from 'react-hot-toast';

interface BrokerConfig {
  id: string;
  name: string;
  logo: string;
  description: string;
  webhookFormat: string;
  orderFields: {
    required: string[];
    optional: string[];
  };
  fieldMappings: {[key: string]: string};
  exampleValues: {[key: string]: any};
}

const WebhookSyntaxGenerator: React.FC = () => {
  const [selectedBroker, setSelectedBroker] = useState<string>('zerodha');
  const [customFields, setCustomFields] = useState<{[key: string]: any}>({
    symbol: 'RELIANCE',
    action: 'BUY',
    quantity: 1,
    order_type: 'MARKET',
    product: 'MIS',
    exchange: 'NSE',
    price: 2500,
    trigger_price: 2450,
    validity: 'DAY',
    disclosed_quantity: 0,
    symboltoken: '2885',
    squareoff: 0,
    stoploss: 0,
    is_amo: false,
    tag: 'TradingView'
  });
  const [generatedSyntax, setGeneratedSyntax] = useState<any>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [brokerConnections, setBrokerConnections] = useState<any[]>([]);
  const [selectedSymbolData, setSelectedSymbolData] = useState<any>(null);
  const [validatingSymbol, setValidatingSymbol] = useState(false);
  const [symbolValidation, setSymbolValidation] = useState<any>(null);

  // Comprehensive broker configurations
  const brokerConfigs: BrokerConfig[] = [
    {
      id: 'zerodha',
      name: 'Zerodha (Kite Connect)',
      logo: '🔥',
      description: 'India\'s largest stockbroker with advanced API support',
      webhookFormat: 'zerodha',
      orderFields: {
        required: ['symbol', 'action', 'quantity', 'order_type', 'product'],
        optional: ['exchange', 'validity', 'price', 'trigger_price', 'disclosed_quantity', 'tag']
      },
      fieldMappings: {
        symbol: 'symbol',
        action: 'action',
        quantity: 'quantity',
        order_type: 'order_type',
        product: 'product',
        exchange: 'exchange',
        validity: 'validity',
        price: 'price',
        trigger_price: 'trigger_price',
        disclosed_quantity: 'disclosed_quantity',
        tag: 'tag'
      },
      exampleValues: {
        exchange: 'NSE',
        validity: 'DAY',
        disclosed_quantity: 0,
        tag: 'TradingView'
      }
    },
    {
      id: 'upstox',
      name: 'Upstox',
      logo: '⚡',
      description: 'Next-generation trading platform with lightning-fast execution',
      webhookFormat: 'upstox',
      orderFields: {
        required: ['symbol', 'action', 'quantity', 'order_type', 'product'],
        optional: ['exchange', 'validity', 'price', 'trigger_price', 'disclosed_quantity', 'is_amo', 'tag']
      },
      fieldMappings: {
        symbol: 'symbol',
        action: 'action',
        quantity: 'quantity',
        order_type: 'order_type',
        product: 'product', // Will be mapped: MIS->I, CNC->D
        exchange: 'exchange', // Will be mapped: NSE->NSE_EQ
        validity: 'validity',
        price: 'price',
        trigger_price: 'trigger_price',
        disclosed_quantity: 'disclosed_quantity',
        is_amo: 'is_amo',
        tag: 'tag'
      },
      exampleValues: {
        exchange: 'NSE_EQ',
        validity: 'DAY',
        disclosed_quantity: 0,
        is_amo: false,
        tag: 'TradingView'
      }
    },
    {
      id: 'angel',
      name: 'Angel Broking (Smart API)',
      logo: '👼',
      description: 'Smart API with comprehensive trading solutions',
      webhookFormat: 'angel',
      orderFields: {
        required: ['symbol', 'symboltoken', 'action', 'quantity', 'order_type', 'product'],
        optional: ['exchange', 'validity', 'price', 'squareoff', 'stoploss']
      },
      fieldMappings: {
        symbol: 'symbol',
        symboltoken: 'symboltoken',
        action: 'action',
        quantity: 'quantity',
        order_type: 'order_type',
        product: 'product', // Will be mapped: MIS->INTRADAY, CNC->DELIVERY
        exchange: 'exchange',
        validity: 'validity',
        price: 'price',
        squareoff: 'squareoff',
        stoploss: 'stoploss'
      },
      exampleValues: {
        exchange: 'NSE',
        validity: 'DAY',
        squareoff: '0',
        stoploss: '0'
      }
    },
    {
      id: 'shoonya',
      name: 'Shoonya (Finvasia)',
      logo: '🚀',
      description: 'Advanced trading platform with low-cost brokerage',
      webhookFormat: 'shoonya',
      orderFields: {
        required: ['symbol', 'action', 'quantity', 'order_type', 'product'],
        optional: ['exchange', 'validity', 'price', 'trigger_price']
      },
      fieldMappings: {
        symbol: 'symbol',
        action: 'action', // Will be mapped: BUY->B, SELL->S
        quantity: 'quantity',
        order_type: 'order_type', // Will be mapped: MARKET->MKT, LIMIT->LMT
        product: 'product', // Will be mapped: MIS->I, CNC->C
        exchange: 'exchange',
        validity: 'validity',
        price: 'price',
        trigger_price: 'trigger_price'
      },
      exampleValues: {
        exchange: 'NSE',
        validity: 'DAY'
      }
    },
    {
      id: '5paisa',
      name: '5Paisa',
      logo: '💎',
      description: 'Cost-effective trading with comprehensive market access',
      webhookFormat: '5paisa',
      orderFields: {
        required: ['symbol', 'action', 'quantity', 'order_type'],
        optional: ['exchange', 'price', 'disclosed_quantity', 'is_intraday']
      },
      fieldMappings: {
        symbol: 'symbol',
        action: 'action', // Will be mapped: BUY->B, SELL->S
        quantity: 'quantity',
        order_type: 'order_type', // Will be mapped: MARKET->M, LIMIT->L
        exchange: 'exchange', // Will be mapped: NSE->N, BSE->B
        price: 'price',
        disclosed_quantity: 'disclosed_quantity',
        is_intraday: 'is_intraday'
      },
      exampleValues: {
        exchange: 'N',
        disclosed_quantity: 0,
        is_intraday: true
      }
    }
  ];

  useEffect(() => {
    // Temporarily disable API calls for testing
    setBrokerConnections([]);
    generateSyntax();
    
    // Original API call (commented out for testing)
    // fetchBrokerConnections();
  }, []);

  useEffect(() => {
    generateSyntax();
  }, [selectedBroker, customFields]);

  const fetchBrokerConnections = async () => {
    // Temporarily disabled for testing
    // try {
    //   const response = await brokerAPI.getConnections();
    //   setBrokerConnections(response.data.connections || []);
    // } catch (error) {
    //   console.error('Failed to fetch broker connections:', error);
    //   setBrokerConnections([]);
    // }
  };

  const generateSyntax = () => {
    const config = brokerConfigs.find(b => b.id === selectedBroker);
    if (!config) return;

    // Use validated symbol data if available
    const symbolToUse = selectedSymbolData?.symbol || customFields.symbol || 'RELIANCE';
    const exchangeToUse = selectedSymbolData?.exchange || customFields.exchange || 'NSE';
    const tokenToUse = selectedSymbolData?.broker_token || customFields.symboltoken || '2885';

    let payload: any = {};

    // Generate enhanced payload based on broker type with actual symbol data
    switch (selectedBroker) {
      case 'zerodha':
        payload = {
          symbol: symbolToUse,
          action: customFields.action || 'BUY',
          quantity: parseInt(customFields.quantity) || 1,
          order_type: customFields.order_type || 'MARKET',
          product: customFields.product || 'MIS',
          exchange: exchangeToUse,
          validity: customFields.validity || 'DAY',
          price: customFields.order_type === 'LIMIT' ? (parseFloat(customFields.price) || 0) : 0,
          trigger_price: ['SL', 'SL-M'].includes(customFields.order_type) ? (parseFloat(customFields.trigger_price) || 0) : 0,
          disclosed_quantity: parseInt(customFields.disclosed_quantity) || 0,
          tag: customFields.tag || 'TradingView'
        };
        break;

      case 'upstox':
        payload = {
          symbol: symbolToUse,
          action: customFields.action || 'BUY',
          quantity: parseInt(customFields.quantity) || 1,
          order_type: customFields.order_type || 'MARKET',
          product: customFields.product === 'MIS' ? 'I' : (customFields.product === 'CNC' ? 'D' : 'I'),
          exchange: exchangeToUse === 'NSE' ? 'NSE_EQ' : exchangeToUse,
          validity: customFields.validity || 'DAY',
          price: customFields.order_type === 'LIMIT' ? (parseFloat(customFields.price) || 0) : 0,
          trigger_price: ['SL', 'SL-M'].includes(customFields.order_type) ? (parseFloat(customFields.trigger_price) || 0) : 0,
          disclosed_quantity: parseInt(customFields.disclosed_quantity) || 0,
          is_amo: customFields.is_amo || false,
          tag: customFields.tag || 'TradingView',
          instrument_token: tokenToUse
        };
        break;

      case 'angel':
        payload = {
          symbol: symbolToUse + (symbolToUse.includes('-') ? '' : '-EQ'),
          symboltoken: tokenToUse,
          action: customFields.action || 'BUY',
          quantity: parseInt(customFields.quantity) || 1,
          order_type: customFields.order_type || 'MARKET',
          product: customFields.product === 'MIS' ? 'INTRADAY' : (customFields.product === 'CNC' ? 'DELIVERY' : 'INTRADAY'),
          exchange: exchangeToUse,
          validity: customFields.validity || 'DAY',
          price: customFields.order_type === 'LIMIT' ? (parseFloat(customFields.price) || 0).toString() : '0',
          squareoff: (parseFloat(customFields.squareoff) || 0).toString(),
          stoploss: ['SL', 'SL-M'].includes(customFields.order_type) ? (parseFloat(customFields.stoploss) || 0).toString() : '0'
        };
        break;

      case 'shoonya':
        payload = {
          symbol: symbolToUse,
          action: customFields.action === 'BUY' ? 'B' : 'S',
          quantity: parseInt(customFields.quantity) || 1,
          order_type: customFields.order_type === 'MARKET' ? 'MKT' : (customFields.order_type === 'LIMIT' ? 'LMT' : 'MKT'),
          product: customFields.product === 'MIS' ? 'I' : (customFields.product === 'CNC' ? 'C' : 'I'),
          exchange: exchangeToUse,
          validity: customFields.validity || 'DAY',
          price: customFields.order_type === 'LIMIT' ? (parseFloat(customFields.price) || 0).toString() : '0',
          trigger_price: ['SL', 'SL-M'].includes(customFields.order_type) ? (parseFloat(customFields.trigger_price) || 0).toString() : '0'
        };
        break;

      case '5paisa':
        payload = {
          symbol: symbolToUse,
          action: customFields.action === 'BUY' ? 'B' : 'S',
          quantity: parseInt(customFields.quantity) || 1,
          order_type: customFields.order_type === 'MARKET' ? 'M' : (customFields.order_type === 'LIMIT' ? 'L' : 'M'),
          exchange: exchangeToUse === 'NSE' ? 'N' : (exchangeToUse === 'BSE' ? 'B' : 'N'),
          price: customFields.order_type === 'LIMIT' ? (parseFloat(customFields.price) || 0) : 0,
          disclosed_quantity: parseInt(customFields.disclosed_quantity) || 0,
          is_intraday: customFields.product === 'MIS'
        };
        break;

      default:
        payload = {};
    }

    // Remove zero values and empty strings for cleaner output
    Object.keys(payload).forEach(key => {
      if (payload[key] === 0 && !['price', 'trigger_price', 'disclosed_quantity'].includes(key)) {
        delete payload[key];
      }
      if (payload[key] === '' || payload[key] === null || payload[key] === undefined) {
        delete payload[key];
      }
    });

    setGeneratedSyntax({
      broker: config.name,
      config: config,
      payload: payload,
      symbol_data: selectedSymbolData,
      validation: symbolValidation
    });
  };

  const validateSymbolForBroker = async (symbol: string, exchange: string) => {
    if (!symbol || !exchange || !selectedBroker) return;
    
    setValidatingSymbol(true);
    try {
      const response = await symbolsAPI.validateSymbol({
        symbol,
        exchange,
        brokerName: selectedBroker
      });
      
      setSymbolValidation(response.data);
      
      if (response.data.valid) {
        setSelectedSymbolData(response.data.mapping);
        toast.success(`Symbol ${symbol} validated for ${selectedBroker}`);
      } else {
        toast.error(response.data.error || 'Symbol not supported by this broker');
        setSelectedSymbolData(null);
      }
    } catch (error) {
      console.error('Symbol validation failed:', error);
      toast.error('Failed to validate symbol');
      setSymbolValidation(null);
      setSelectedSymbolData(null);
    } finally {
      setValidatingSymbol(false);
    }
  };

  const generateWebhookPayload = async () => {
    if (!selectedSymbolData || !selectedBroker) {
      toast.error('Please select a valid symbol first');
      return;
    }
    
    try {
      const response = await symbolsAPI.generateWebhookPayload({
        symbol: selectedSymbolData.symbol,
        exchange: selectedSymbolData.exchange,
        brokerName: selectedBroker,
        orderParams: customFields
      });
      
      setGeneratedSyntax(response.data);
      toast.success('Webhook payload generated successfully');
    } catch (error) {
      console.error('Failed to generate webhook payload:', error);
      toast.error('Failed to generate webhook payload');
    }
  };

  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    toast.success(`${section} copied to clipboard!`);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const downloadSyntax = () => {
    if (!generatedSyntax) return;
    
    const content = `# ${generatedSyntax.broker} Webhook Syntax

## Broker Information
- **Name**: ${generatedSyntax.broker}
- **Format**: ${generatedSyntax.config.webhookFormat}
- **Description**: ${generatedSyntax.config.description}

## Required Fields
${generatedSyntax.config.orderFields.required.map((field: string) => `- ${field}`).join('\n')}

## Optional Fields
${generatedSyntax.config.orderFields.optional.map((field: string) => `- ${field}`).join('\n')}

## Example Webhook Payload
\`\`\`json
${JSON.stringify(generatedSyntax.payload, null, 2)}
\`\`\`

## TradingView Setup Instructions

### Step 1: Create Alert
1. Open your TradingView chart
2. Click on the Alert button (clock icon)
3. Set your alert conditions

### Step 2: Configure Webhook
1. In the Notifications tab, enable "Webhook URL"
2. Enter your webhook URL: \`YOUR_WEBHOOK_URL_HERE\`
3. In the "Message" field, paste the JSON payload above

### Step 3: Customize Payload
- Replace \`YOUR_WEBHOOK_URL_HERE\` with your actual webhook URL
- Modify symbol, quantity, and other parameters as needed
- Use TradingView variables like {{close}} for dynamic values

### Step 4: Test and Activate
1. Test your alert with a small quantity first
2. Monitor the execution in your AutoTraderHub dashboard
3. Activate the alert for live trading

## Important Notes
- Ensure your broker account has sufficient margin
- Test with paper trading first
- Monitor your positions regularly
- Keep your API credentials secure

Generated by AutoTraderHub - ${new Date().toISOString()}
`;

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedBroker}-webhook-syntax.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Syntax documentation downloaded!');
  };

  const getWebhookUrl = () => {
    const connection = brokerConnections.find(conn => 
      conn.broker_name.toLowerCase() === selectedBroker && conn.is_active
    );
    return connection?.webhook_url || `Connect your ${selectedBroker} broker to get webhook URL`;
  };

  const getCurrentBrokerConfig = () => {
    return brokerConfigs.find(b => b.id === selectedBroker);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-bronze-800 flex items-center">
            <Webhook className="w-8 h-8 mr-3 text-amber-600" />
            Webhook Syntax Generator
          </h1>
          <p className="text-bronze-600 mt-1">
            Generate broker-specific webhook payloads for TradingView alerts
          </p>
        </div>
        
        <div className="flex items-center space-x-3 mt-4 sm:mt-0">
          <motion.button
            onClick={downloadSyntax}
            disabled={!generatedSyntax}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center space-x-2 bg-bronze-600 text-white px-4 py-2 rounded-lg hover:bg-bronze-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-3d"
          >
            <Download className="w-4 h-4" />
            <span>Download Guide</span>
          </motion.button>
          
          <motion.button
            onClick={generateSyntax}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center space-x-2 bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 transition-colors shadow-3d"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Regenerate</span>
          </motion.button>
          
          {selectedSymbolData && (
            <motion.button
              onClick={generateWebhookPayload}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center space-x-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors shadow-3d"
            >
              <Zap className="w-4 h-4" />
              <span>Generate with Validated Data</span>
            </motion.button>
          )}
        </div>
      </motion.div>

      {/* Broker Selection */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-beige-200"
      >
        <h2 className="text-xl font-bold text-bronze-800 mb-4 flex items-center">
          <Database className="w-5 h-5 mr-2 text-amber-600" />
          Select Your Broker
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {brokerConfigs.map((broker) => (
            <motion.div
              key={broker.id}
              onClick={() => setSelectedBroker(broker.id)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                selectedBroker === broker.id
                  ? 'border-amber-500 bg-amber-50 shadow-3d'
                  : 'border-beige-200 bg-cream-50 hover:border-amber-300'
              }`}
            >
              <div className="flex items-center space-x-3 mb-2">
                <span className="text-2xl">{broker.logo}</span>
                <div>
                  <h3 className="font-bold text-bronze-800">{broker.name}</h3>
                  <p className="text-xs text-bronze-600">{broker.description}</p>
                </div>
              </div>
              {selectedBroker === broker.id && (
                <div className="mt-2 flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-amber-600" />
                  <span className="text-sm text-amber-700 font-medium">Selected</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Symbol Selection */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-beige-200"
      >
        <h2 className="text-xl font-bold text-bronze-800 mb-4 flex items-center">
          <Search className="w-5 h-5 mr-2 text-amber-600" />
          Select Trading Symbol
        </h2>
        
        <div className="space-y-4">
          <SymbolSearch
            onSymbolSelect={(symbol) => {
              setCustomFields({
                ...customFields,
                symbol: symbol.symbol,
                exchange: symbol.exchange,
                symboltoken: symbol.broker_tokens?.[0] || customFields.symboltoken
              });
              
              // Validate symbol for selected broker
              validateSymbolForBroker(symbol.symbol, symbol.exchange);
            }}
            selectedBroker={selectedBroker}
            placeholder="Search for trading symbols..."
            className="w-full"
          />
          
          {/* Symbol Validation Status */}
          {validatingSymbol && (
            <div className="flex items-center space-x-2 text-blue-600">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Validating symbol for {selectedBroker}...</span>
            </div>
          )}
          
          {symbolValidation && (
            <div className={`p-3 rounded-lg border ${
              symbolValidation.valid 
                ? 'bg-green-50 border-green-200' 
                : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center space-x-2">
                {symbolValidation.valid ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600" />
                )}
                <span className={`text-sm font-medium ${
                  symbolValidation.valid ? 'text-green-800' : 'text-red-800'
                }`}>
                  {symbolValidation.valid 
                    ? `Symbol validated for ${selectedBroker}` 
                    : symbolValidation.error
                  }
                </span>
              </div>
              
              {symbolValidation.valid && selectedSymbolData && (
                <div className="mt-2 text-xs text-green-700">
                  <p><strong>Token:</strong> {selectedSymbolData.broker_token}</p>
                  <p><strong>Broker Symbol:</strong> {selectedSymbolData.broker_symbol}</p>
                  <p><strong>Exchange:</strong> {selectedSymbolData.broker_exchange}</p>
                </div>
              )}
              
              {!symbolValidation.valid && symbolValidation.suggestions?.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-red-700 mb-1">Similar symbols:</p>
                  <div className="flex flex-wrap gap-1">
                    {symbolValidation.suggestions.map((suggestion: any, index: number) => (
                      <button
                        key={index}
                        onClick={() => {
                          setCustomFields({
                            ...customFields,
                            symbol: suggestion.symbol,
                            exchange: suggestion.exchange
                          });
                          validateSymbolForBroker(suggestion.symbol, suggestion.exchange);
                        }}
                        className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded hover:bg-red-200 transition-colors"
                      >
                        {suggestion.symbol}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          <div className="text-sm text-bronze-600">
            <p>💡 <strong>Tip:</strong> Use the search above to find symbols or enter them manually in the configuration below.</p>
            <p>The search will automatically populate the symbol, exchange, and token fields.</p>
          </div>
        </div>
      </motion.div>

      {/* Order Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-beige-200"
      >
        <h2 className="text-xl font-bold text-bronze-800 mb-4 flex items-center">
          <Settings className="w-5 h-5 mr-2 text-amber-600" />
          Configure Order Parameters
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Basic Fields */}
          <div>
            <label className="block text-sm font-medium text-bronze-700 mb-1">Symbol *</label>
            <input
              type="text"
              value={customFields.symbol}
              onChange={(e) => setCustomFields({...customFields, symbol: e.target.value.toUpperCase()})}
              className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="RELIANCE"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-bronze-700 mb-1">Action *</label>
            <select
              value={customFields.action}
              onChange={(e) => setCustomFields({...customFields, action: e.target.value})}
              className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-bronze-700 mb-1">Quantity *</label>
            <input
              type="number"
              value={customFields.quantity}
              onChange={(e) => setCustomFields({...customFields, quantity: e.target.value})}
              className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              min="1"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-bronze-700 mb-1">Order Type *</label>
            <select
              value={customFields.order_type}
              onChange={(e) => setCustomFields({...customFields, order_type: e.target.value})}
              className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              <option value="MARKET">MARKET</option>
              <option value="LIMIT">LIMIT</option>
              <option value="SL">STOP LOSS</option>
              <option value="SL-M">STOP LOSS MARKET</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-bronze-700 mb-1">Product *</label>
            <select
              value={customFields.product}
              onChange={(e) => setCustomFields({...customFields, product: e.target.value})}
              className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              <option value="MIS">MIS (Intraday)</option>
              <option value="CNC">CNC (Delivery)</option>
              <option value="NRML">NRML (Normal)</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-bronze-700 mb-1">Exchange</label>
            <select
              value={customFields.exchange}
              onChange={(e) => setCustomFields({...customFields, exchange: e.target.value})}
              className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
              <option value="NFO">NFO</option>
              <option value="BFO">BFO</option>
            </select>
          </div>

          {/* Conditional Fields */}
          {customFields.order_type === 'LIMIT' && (
            <div>
              <label className="block text-sm font-medium text-bronze-700 mb-1">Price</label>
              <input
                type="number"
                value={customFields.price}
                onChange={(e) => setCustomFields({...customFields, price: e.target.value})}
                className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="2500"
                step="0.01"
              />
            </div>
          )}

          {(customFields.order_type === 'SL' || customFields.order_type === 'SL-M') && (
            <div>
              <label className="block text-sm font-medium text-bronze-700 mb-1">Trigger Price</label>
              <input
                type="number"
                value={customFields.trigger_price}
                onChange={(e) => setCustomFields({...customFields, trigger_price: e.target.value})}
                className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="2450"
                step="0.01"
              />
            </div>
          )}

          {/* Angel Broking specific fields */}
          {selectedBroker === 'angel' && (
            <div>
              <label className="block text-sm font-medium text-bronze-700 mb-1">Symbol Token *</label>
              <input
                type="text"
                value={customFields.symboltoken}
                onChange={(e) => setCustomFields({...customFields, symboltoken: e.target.value})}
                className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="2885"
              />
              <p className="text-xs text-bronze-500 mt-1">Required for Angel Broking orders</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Generated Syntax Display */}
      <AnimatePresence>
        {generatedSyntax && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ delay: 0.3 }}
            className="space-y-6"
          >
            {/* Webhook URL */}
            <motion.div
              whileHover={{ scale: 1.005 }}
              className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-beige-200"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-bronze-800 flex items-center">
                  <Webhook className="w-5 h-5 mr-2 text-amber-600" />
                  Webhook URL for {generatedSyntax.broker}
                </h3>
                <motion.button
                  onClick={() => copyToClipboard(getWebhookUrl(), 'Webhook URL')}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="text-amber-600 hover:text-amber-500"
                >
                  {copiedSection === 'Webhook URL' ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <Copy className="w-5 h-5" />
                  )}
                </motion.button>
              </div>
              
              <div className="bg-gray-100 rounded-lg p-3 font-mono text-sm break-all">
                {getWebhookUrl()}
              </div>
              <p className="text-xs text-bronze-500 mt-2">
                Copy this URL and paste it in your TradingView alert webhook configuration
              </p>
            </motion.div>

            {/* Field Requirements */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <motion.div
                whileHover={{ scale: 1.01 }}
                className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-red-200"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-bronze-800 flex items-center">
                    <AlertCircle className="w-5 h-5 mr-2 text-red-600" />
                    Required Fields
                  </h3>
                  <motion.button
                    onClick={() => copyToClipboard(generatedSyntax.config.orderFields.required.join(', '), 'Required Fields')}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="text-amber-600 hover:text-amber-500"
                  >
                    {copiedSection === 'Required Fields' ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </motion.button>
                </div>
                <div className="space-y-2">
                  {generatedSyntax.config.orderFields.required.map((field: string, index: number) => (
                    <div key={index} className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <code className="text-sm text-bronze-700 bg-red-50 px-2 py-1 rounded">{field}</code>
                    </div>
                  ))}
                </div>
              </motion.div>

              <motion.div
                whileHover={{ scale: 1.01 }}
                className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-blue-200"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-bronze-800 flex items-center">
                    <Settings className="w-5 h-5 mr-2 text-blue-600" />
                    Optional Fields
                  </h3>
                  <motion.button
                    onClick={() => copyToClipboard(generatedSyntax.config.orderFields.optional.join(', '), 'Optional Fields')}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="text-amber-600 hover:text-amber-500"
                  >
                    {copiedSection === 'Optional Fields' ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </motion.button>
                </div>
                <div className="space-y-2">
                  {generatedSyntax.config.orderFields.optional.map((field: string, index: number) => (
                    <div key={index} className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                      <code className="text-sm text-bronze-700 bg-blue-50 px-2 py-1 rounded">{field}</code>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Generated Payload */}
            <motion.div
              whileHover={{ scale: 1.005 }}
              className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-beige-200"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-bronze-800 flex items-center">
                  <Code className="w-5 h-5 mr-2 text-amber-600" />
                  Generated Webhook Payload
                </h3>
                <div className="flex items-center space-x-2">
                  <motion.button
                    onClick={() => copyToClipboard(JSON.stringify(generatedSyntax.payload, null, 2), 'Webhook Payload')}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="text-amber-600 hover:text-amber-500"
                  >
                    {copiedSection === 'Webhook Payload' ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </motion.button>
                </div>
              </div>
              
              <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                <pre className="text-green-400 text-sm">
                  <code>{JSON.stringify(generatedSyntax.payload, null, 2)}</code>
                </pre>
              </div>
              
              {/* Symbol Data Display */}
              {generatedSyntax.symbol_data && (
                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                  <h4 className="font-bold text-blue-800 mb-2 flex items-center">
                    <Database className="w-4 h-4 mr-1" />
                    Validated Symbol Data:
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm text-blue-700">
                    <div><strong>Symbol:</strong> {generatedSyntax.symbol_data.symbol}</div>
                    <div><strong>Exchange:</strong> {generatedSyntax.symbol_data.exchange}</div>
                    <div><strong>Broker Token:</strong> {generatedSyntax.symbol_data.broker_token}</div>
                    <div><strong>Broker Symbol:</strong> {generatedSyntax.symbol_data.broker_symbol}</div>
                    <div><strong>Lot Size:</strong> {generatedSyntax.symbol_data.lot_size}</div>
                    <div><strong>Tick Size:</strong> {generatedSyntax.symbol_data.tick_size}</div>
                  </div>
                </div>
              )}
              
              <div className="mt-4 p-4 bg-amber-50 rounded-lg">
                <h4 className="font-bold text-amber-800 mb-2 flex items-center">
                  <Zap className="w-4 h-4 mr-1" />
                  Usage Instructions:
                </h4>
                <ol className="text-amber-700 text-sm space-y-1 list-decimal list-inside">
                  <li>Copy the webhook URL above</li>
                  <li>Copy the JSON payload above</li>
                  <li>In TradingView, create an alert and enable "Webhook URL"</li>
                  <li>Paste the webhook URL in the URL field</li>
                  <li>Paste the JSON payload in the Message field</li>
                  <li>Test and activate your alert</li>
                </ol>
              </div>
            </motion.div>

            {/* TradingView Setup Guide */}
            <motion.div
              whileHover={{ scale: 1.005 }}
              className="bg-gradient-to-r from-amber-50 to-bronze-50 rounded-2xl p-6 border border-amber-200 shadow-3d"
            >
              <h3 className="text-lg font-bold text-bronze-800 mb-4 flex items-center">
                <Play className="w-5 h-5 mr-2 text-amber-600" />
                TradingView Setup Guide
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold">1</div>
                    <div>
                      <p className="text-bronze-800 font-medium">Create Alert</p>
                      <p className="text-bronze-600 text-sm">Open TradingView chart and click Alert button</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold">2</div>
                    <div>
                      <p className="text-bronze-800 font-medium">Configure Webhook</p>
                      <p className="text-bronze-600 text-sm">Enable "Webhook URL" in Notifications tab</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold">3</div>
                    <div>
                      <p className="text-bronze-800 font-medium">Add Payload</p>
                      <p className="text-bronze-600 text-sm">Paste JSON payload in Message field</p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold">4</div>
                    <div>
                      <p className="text-bronze-800 font-medium">Test Alert</p>
                      <p className="text-bronze-600 text-sm">Test with small quantity first</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold">5</div>
                    <div>
                      <p className="text-bronze-800 font-medium">Monitor Trades</p>
                      <p className="text-bronze-600 text-sm">Check execution in Orders dashboard</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <div className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold">6</div>
                    <div>
                      <p className="text-bronze-800 font-medium">Go Live</p>
                      <p className="text-bronze-600 text-sm">Activate alert for automated trading</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-amber-100 rounded-lg">
                <h4 className="font-bold text-amber-800 mb-2 flex items-center">
                  <Shield className="w-4 h-4 mr-1" />
                  Important Safety Tips:
                </h4>
                <ul className="text-amber-700 text-sm space-y-1">
                  <li>• Always test with small quantities before going live</li>
                  <li>• Ensure sufficient margin in your broker account</li>
                  <li>• Monitor your positions regularly</li>
                  <li>• Keep your API credentials secure</li>
                  <li>• Use stop-loss orders to manage risk</li>
                </ul>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default WebhookSyntaxGenerator;