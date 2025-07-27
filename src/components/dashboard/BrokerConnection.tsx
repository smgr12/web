import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Trash2, RefreshCw, ExternalLink, Copy, CheckCircle, 
  AlertTriangle, Wifi, WifiOff, Settings, Eye, EyeOff, 
  Shield, Zap, Clock, Database, Link as LinkIcon
} from 'lucide-react';
import { brokerAPI } from '../../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface BrokerConnection {
  id: number;
  broker_name: string;
  connection_name: string;
  is_active: boolean;
  is_authenticated: boolean;
  webhook_url: string;
  created_at: string;
  last_sync: string;
  access_token_expires_at: number;
  token_expired: boolean;
  needs_token_refresh: boolean;
}

interface BrokerConfig {
  id: string;
  name: string;
  logo: string;
  description: string;
  authMethod: string;
  requiredFields: string[];
  optionalFields: string[];
}

const BrokerConnection: React.FC = () => {
  const [connections, setConnections] = useState<BrokerConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState('');
  const [formData, setFormData] = useState<{[key: string]: string}>({});
  const [submitting, setSubmitting] = useState(false);
  const [reconnectingConnection, setReconnectingConnection] = useState<number | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState<number | null>(null);
  const [showPasswords, setShowPasswords] = useState<{[key: string]: boolean}>({});

  // Enhanced broker configurations including MT4/MT5
  const brokerConfigs: BrokerConfig[] = [
    {
      id: 'zerodha',
      name: 'Zerodha (Kite Connect)',
      logo: '🔥',
      description: 'India\'s largest stockbroker with advanced API support',
      authMethod: 'oauth',
      requiredFields: ['apiKey', 'apiSecret'],
      optionalFields: ['connectionName']
    },
    {
      id: 'upstox',
      name: 'Upstox',
      logo: '⚡',
      description: 'Next-generation trading platform with lightning-fast execution',
      authMethod: 'oauth',
      requiredFields: ['apiKey', 'apiSecret', 'redirectUri'],
      optionalFields: ['connectionName']
    },
    {
      id: 'angel',
      name: 'Angel Broking (Smart API)',
      logo: '👼',
      description: 'Smart API with comprehensive trading solutions',
      authMethod: 'manual',
      requiredFields: ['apiKey', 'clientCode'],
      optionalFields: ['connectionName', 'password', 'pin']
    },
    {
      id: 'shoonya',
      name: 'Shoonya (Finvasia)',
      logo: '🚀',
      description: 'Advanced trading platform with low-cost brokerage',
      authMethod: 'manual',
      requiredFields: ['apiKey', 'userId', 'vendorCode', 'imei'],
      optionalFields: ['connectionName', 'apiSecret']
    },
    {
      id: '5paisa',
      name: '5Paisa',
      logo: '💎',
      description: 'Cost-effective trading with comprehensive market access',
      authMethod: 'oauth',
      requiredFields: ['apiKey', 'apiSecret', 'appKey'],
      optionalFields: ['connectionName', 'userId']
    },
    {
      id: 'mt4',
      name: 'MetaTrader 4',
      logo: '📊',
      description: 'Popular forex and CFD trading platform',
      authMethod: 'manual',
      requiredFields: ['apiKey', 'apiSecret', 'serverUrl', 'login', 'password'],
      optionalFields: ['connectionName', 'imei']
    },
    {
      id: 'mt5',
      name: 'MetaTrader 5',
      logo: '📈',
      description: 'Advanced multi-asset trading platform',
      authMethod: 'manual',
      requiredFields: ['apiKey', 'apiSecret', 'serverUrl', 'login', 'password'],
      optionalFields: ['connectionName', 'imei']
    }
  ];

  useEffect(() => {
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    try {
      setLoading(true);
      const response = await brokerAPI.getConnections();
      setConnections(response.data.connections);
    } catch (error) {
      console.error('Failed to fetch connections:', error);
      toast.error('Failed to fetch broker connections');
    } finally {
      setLoading(false);
    }
  };

  const handleAddConnection = async () => {
    if (!selectedBroker) {
      toast.error('Please select a broker');
      return;
    }

    const config = brokerConfigs.find(b => b.id === selectedBroker);
    if (!config) {
      toast.error('Invalid broker selected');
      return;
    }

    // Validate required fields
    const missingFields = config.requiredFields.filter(field => !formData[field]);
    if (missingFields.length > 0) {
      toast.error(`Missing required fields: ${missingFields.join(', ')}`);
      return;
    }

    setSubmitting(true);
    try {
      const connectionData = {
        brokerName: selectedBroker,
        connectionName: formData.connectionName || `${config.name} Connection`,
        apiKey: formData.apiKey,
        apiSecret: formData.apiSecret,
        userId: formData.userId || formData.clientCode,
        vendorCode: formData.vendorCode,
        redirectUri: formData.redirectUri,
        serverUrl: formData.serverUrl,
        login: formData.login,
        password: formData.password,
        pin: formData.pin,
        imei: formData.imei,
        appKey: formData.appKey
      };

      const response = await brokerAPI.connect(connectionData);

      if (response.data.requiresAuth && response.data.loginUrl) {
        // Open OAuth window
        const authWindow = window.open(
          response.data.loginUrl,
          'broker-auth',
          'width=600,height=700,scrollbars=yes,resizable=yes'
        );

        if (authWindow) {
          const checkClosed = setInterval(() => {
            if (authWindow.closed) {
              clearInterval(checkClosed);
              setTimeout(() => {
                fetchConnections();
                setShowAddForm(false);
                setFormData({});
                setSelectedBroker('');
              }, 2000);
            }
          }, 1000);

          setTimeout(() => {
            if (!authWindow.closed) {
              authWindow.close();
              clearInterval(checkClosed);
            }
          }, 300000);
        } else {
          toast.error('Failed to open authentication window. Please check your popup blocker.');
        }
      } else {
        toast.success('Broker connected successfully!');
        fetchConnections();
        setShowAddForm(false);
        setFormData({});
        setSelectedBroker('');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to connect broker');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReconnect = async (connectionId: number) => {
    setReconnectingConnection(connectionId);
    try {
      const response = await brokerAPI.reconnect(connectionId);
      
      if (response.data.requiresAuth && response.data.loginUrl) {
        const authWindow = window.open(
          response.data.loginUrl,
          'reconnect-auth',
          'width=600,height=700,scrollbars=yes,resizable=yes'
        );

        if (authWindow) {
          const checkClosed = setInterval(() => {
            if (authWindow.closed) {
              clearInterval(checkClosed);
              setTimeout(() => {
                fetchConnections();
              }, 2000);
            }
          }, 1000);

          setTimeout(() => {
            if (!authWindow.closed) {
              authWindow.close();
              clearInterval(checkClosed);
            }
          }, 300000);
        } else {
          toast.error('Failed to open authentication window. Please check your popup blocker.');
        }
      } else {
        toast.success('Reconnected successfully!');
        fetchConnections();
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to reconnect');
    } finally {
      setReconnectingConnection(null);
    }
  };

  const handleDeleteConnection = async (connectionId: number) => {
    if (!confirm('Are you sure you want to delete this connection?')) {
      return;
    }

    try {
      await brokerAPI.deleteConnection(connectionId);
      toast.success('Connection deleted successfully');
      fetchConnections();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to delete connection');
    }
  };

  const copyWebhookUrl = (webhookUrl: string, connectionId: number) => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(connectionId);
    toast.success('Webhook URL copied!');
    setTimeout(() => setCopiedWebhook(null), 2000);
  };

  const getConnectionStatus = (connection: BrokerConnection) => {
    if (!connection.is_authenticated) {
      return {
        status: 'Not Authenticated',
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        icon: AlertTriangle
      };
    }
    
    if (connection.token_expired) {
      return {
        status: 'Token Expired',
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        icon: AlertTriangle
      };
    }
    
    if (connection.needs_token_refresh) {
      const hoursLeft = Math.floor((connection.access_token_expires_at - Math.floor(Date.now() / 1000)) / 3600);
      return {
        status: `Expires in ${hoursLeft}h`,
        color: 'text-amber-600',
        bgColor: 'bg-amber-100',
        icon: Clock
      };
    }
    
    return {
      status: 'Connected',
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      icon: CheckCircle
    };
  };

  const togglePasswordVisibility = (field: string) => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const renderFormField = (field: string, config: BrokerConfig) => {
    const isRequired = config.requiredFields.includes(field);
    const isPassword = ['password', 'pin', 'apiSecret'].includes(field);
    
    const fieldLabels: {[key: string]: string} = {
      apiKey: 'API Key',
      apiSecret: 'API Secret',
      connectionName: 'Connection Name',
      userId: 'User ID',
      clientCode: 'Client Code',
      vendorCode: 'Vendor Code',
      redirectUri: 'Redirect URI',
      serverUrl: 'Server URL',
      login: 'Login',
      password: 'Password',
      pin: 'PIN',
      imei: 'IMEI',
      appKey: 'App Key'
    };

    const fieldPlaceholders: {[key: string]: string} = {
      apiKey: 'Enter your API key',
      apiSecret: 'Enter your API secret',
      connectionName: `My ${config.name} Account`,
      userId: 'Your user ID',
      clientCode: 'Your client code',
      vendorCode: 'Your vendor code',
      redirectUri: 'https://your-app.com/callback',
      serverUrl: 'mt4-server.broker.com:443',
      login: 'Your MT login number',
      password: 'Your password',
      pin: 'Your PIN',
      imei: 'Device IMEI (optional)',
      appKey: 'Your app key'
    };

    return (
      <div key={field}>
        <label className="block text-sm font-medium text-bronze-700 mb-1">
          {fieldLabels[field] || field} {isRequired && <span className="text-red-500">*</span>}
        </label>
        <div className="relative">
          <input
            type={isPassword && !showPasswords[field] ? 'password' : 'text'}
            value={formData[field] || ''}
            onChange={(e) => setFormData({...formData, [field]: e.target.value})}
            className="w-full px-3 py-2 bg-cream-50 border border-beige-200 rounded-lg text-bronze-800 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            placeholder={fieldPlaceholders[field] || `Enter ${field}`}
            required={isRequired}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => togglePasswordVisibility(field)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-bronze-400 hover:text-bronze-600"
            >
              {showPasswords[field] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
        {field === 'redirectUri' && selectedBroker === 'upstox' && (
          <p className="text-xs text-bronze-500 mt-1">
            Use: http://localhost:3000/auth/upstox/callback for development
          </p>
        )}
        {field === 'serverUrl' && ['mt4', 'mt5'].includes(selectedBroker) && (
          <p className="text-xs text-bronze-500 mt-1">
            Format: server.broker.com:port (e.g., mt4-server.broker.com:443)
          </p>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    );
  }

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
            <LinkIcon className="w-8 h-8 mr-3 text-amber-600" />
            Broker Connections
          </h1>
          <p className="text-bronze-600 mt-1">
            Connect and manage your trading accounts across multiple brokers
          </p>
        </div>
        
        <div className="flex items-center space-x-3 mt-4 sm:mt-0">
          <motion.button
            onClick={fetchConnections}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center space-x-2 bg-bronze-600 text-white px-4 py-2 rounded-lg hover:bg-bronze-700 transition-colors shadow-3d"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh</span>
          </motion.button>
          
          <motion.button
            onClick={() => setShowAddForm(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center space-x-2 bg-gradient-to-r from-amber-500 to-bronze-600 text-white px-4 py-2 rounded-lg hover:shadow-3d-hover transition-all shadow-3d"
          >
            <Plus className="w-4 h-4" />
            <span>Add Broker</span>
          </motion.button>
        </div>
      </motion.div>

      {/* Existing Connections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {connections.map((connection, index) => {
          const config = brokerConfigs.find(b => b.id === connection.broker_name.toLowerCase());
          const status = getConnectionStatus(connection);
          
          return (
            <motion.div
              key={connection.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ scale: 1.02 }}
              className="bg-white/90 backdrop-blur-xl rounded-2xl p-6 shadow-3d border border-beige-200 hover:shadow-3d-hover transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="text-3xl">
                    {config?.logo || '🏦'}
                  </div>
                  <div>
                    <h3 className="font-bold text-bronze-800 capitalize">{connection.broker_name}</h3>
                    <p className="text-sm text-bronze-600">{connection.connection_name}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <motion.button
                    onClick={() => handleDeleteConnection(connection.id)}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="text-red-600 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </motion.button>
                </div>
              </div>

              {/* Connection Status */}
              <div className={`inline-flex items-center space-x-2 px-3 py-1 rounded-full text-sm font-medium mb-4 ${status.bgColor} ${status.color}`}>
                <status.icon className="w-4 h-4" />
                <span>{status.status}</span>
              </div>

              {/* Connection Details */}
              <div className="space-y-2 text-sm text-bronze-600 mb-4">
                <div className="flex justify-between">
                  <span>Created:</span>
                  <span>{format(new Date(connection.created_at), 'MMM dd, yyyy')}</span>
                </div>
                {connection.last_sync && (
                  <div className="flex justify-between">
                    <span>Last Sync:</span>
                    <span>{format(new Date(connection.last_sync), 'MMM dd, HH:mm')}</span>
                  </div>
                )}
                {connection.access_token_expires_at && (
                  <div className="flex justify-between">
                    <span>Token Expires:</span>
                    <span>{format(new Date(connection.access_token_expires_at * 1000), 'MMM dd, HH:mm')}</span>
                  </div>
                )}
              </div>

              {/* Webhook URL */}
              {connection.webhook_url && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-bronze-600">Webhook URL:</span>
                    <motion.button
                      onClick={() => copyWebhookUrl(connection.webhook_url, connection.id)}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      className="text-amber-600 hover:text-amber-500"
                    >
                      {copiedWebhook === connection.id ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </motion.button>
                  </div>
                  <code className="text-xs text-bronze-700 break-all block bg-beige-50 p-2 rounded">
                    {connection.webhook_url.length > 50 
                      ? `${connection.webhook_url.substring(0, 50)}...`
                      : connection.webhook_url
                    }
                  </code>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex space-x-2">
                {(!connection.is_authenticated || connection.token_expired || connection.needs_token_refresh) && (
                  <motion.button
                    onClick={() => handleReconnect(connection.id)}
                    disabled={reconnectingConnection === connection.id}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex-1 bg-amber-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-amber-700 transition-colors disabled:opacity-50 shadow-3d"
                  >
                    {reconnectingConnection === connection.id ? (
                      <RefreshCw className="w-4 h-4 animate-spin mx-auto" />
                    ) : (
                      'Reconnect'
                    )}
                  </motion.button>
                )}
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="flex-1 bg-beige-100 text-bronze-700 px-3 py-2 rounded-lg text-sm hover:bg-beige-200 transition-colors"
                >
                  <Settings className="w-4 h-4 mx-auto" />
                </motion.button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Empty State */}
      {connections.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12 bg-white/80 backdrop-blur-xl rounded-2xl shadow-3d border border-beige-200"
        >
          <Wifi className="w-16 h-16 text-amber-400/50 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-bronze-800 mb-2">No Broker Connections</h3>
          <p className="text-bronze-600 mb-6">
            Connect your first broker account to start automated trading
          </p>
          <motion.button
            onClick={() => setShowAddForm(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="bg-gradient-to-r from-amber-500 to-bronze-600 text-white px-6 py-3 rounded-lg font-medium hover:shadow-3d-hover transition-all shadow-3d"
          >
            Connect Your First Broker
          </motion.button>
        </motion.div>
      )}

      {/* Add Connection Modal */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-beige-200 shadow-3d"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-bronze-800">Add Broker Connection</h3>
                <motion.button
                  onClick={() => {
                    setShowAddForm(false);
                    setSelectedBroker('');
                    setFormData({});
                  }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="text-bronze-600 hover:text-bronze-500 text-xl"
                >
                  ✕
                </motion.button>
              </div>

              {!selectedBroker ? (
                <div>
                  <h4 className="text-lg font-semibold text-bronze-800 mb-4">Select a Broker</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {brokerConfigs.map((broker) => (
                      <motion.div
                        key={broker.id}
                        onClick={() => setSelectedBroker(broker.id)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="p-4 border-2 border-beige-200 rounded-xl cursor-pointer hover:border-amber-300 transition-colors"
                      >
                        <div className="flex items-center space-x-3 mb-2">
                          <span className="text-2xl">{broker.logo}</span>
                          <div>
                            <h5 className="font-bold text-bronze-800">{broker.name}</h5>
                            <p className="text-xs text-bronze-600">{broker.description}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                          <span className={`px-2 py-1 rounded-full ${
                            broker.authMethod === 'oauth' 
                              ? 'bg-blue-100 text-blue-800' 
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {broker.authMethod === 'oauth' ? 'OAuth' : 'Manual Auth'}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center space-x-3 mb-6">
                    <motion.button
                      onClick={() => {
                        setSelectedBroker('');
                        setFormData({});
                      }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      className="text-bronze-600 hover:text-bronze-500"
                    >
                      ←
                    </motion.button>
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">
                        {brokerConfigs.find(b => b.id === selectedBroker)?.logo}
                      </span>
                      <div>
                        <h4 className="text-lg font-semibold text-bronze-800">
                          {brokerConfigs.find(b => b.id === selectedBroker)?.name}
                        </h4>
                        <p className="text-sm text-bronze-600">
                          {brokerConfigs.find(b => b.id === selectedBroker)?.description}
                        </p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={(e) => { e.preventDefault(); handleAddConnection(); }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      {(() => {
                        const config = brokerConfigs.find(b => b.id === selectedBroker);
                        if (!config) return null;
                        
                        const allFields = [...config.requiredFields, ...config.optionalFields];
                        return allFields.map(field => renderFormField(field, config));
                      })()}
                    </div>

                    {/* Special Instructions */}
                    {selectedBroker === 'zerodha' && (
                      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h5 className="font-semibold text-blue-800 mb-2">Zerodha Setup Instructions:</h5>
                        <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                          <li>Login to Kite Connect Developer Console</li>
                          <li>Create a new app and get API Key & Secret</li>
                          <li>Set redirect URL to: http://localhost:3000/auth/zerodha/callback</li>
                          <li>Enter your API credentials above</li>
                        </ol>
                      </div>
                    )}

                    {selectedBroker === 'upstox' && (
                      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h5 className="font-semibold text-blue-800 mb-2">Upstox Setup Instructions:</h5>
                        <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                          <li>Login to Upstox Developer Console</li>
                          <li>Create a new app and get API Key & Secret</li>
                          <li>Set redirect URL to match the one entered above</li>
                          <li>Enter your API credentials above</li>
                        </ol>
                      </div>
                    )}

                    {['mt4', 'mt5'].includes(selectedBroker) && (
                      <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <h5 className="font-semibold text-purple-800 mb-2">
                          {selectedBroker.toUpperCase()} Setup Instructions:
                        </h5>
                        <ol className="text-sm text-purple-700 space-y-1 list-decimal list-inside">
                          <li>Register at mtsocketapi.com and get API credentials</li>
                          <li>Get your MT server URL from your broker</li>
                          <li>Use your MT login number and password</li>
                          <li>Ensure your MT platform allows API connections</li>
                        </ol>
                      </div>
                    )}

                    <div className="flex space-x-4">
                      <motion.button
                        type="button"
                        onClick={() => {
                          setShowAddForm(false);
                          setSelectedBroker('');
                          setFormData({});
                        }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex-1 bg-beige-100 text-bronze-700 py-3 rounded-lg font-medium hover:bg-beige-200 transition-colors"
                      >
                        Cancel
                      </motion.button>
                      
                      <motion.button
                        type="submit"
                        disabled={submitting}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex-1 bg-gradient-to-r from-amber-500 to-bronze-600 text-white py-3 rounded-lg font-medium hover:shadow-3d-hover transition-all disabled:opacity-50 shadow-3d"
                      >
                        {submitting ? (
                          <div className="flex items-center justify-center space-x-2">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Connecting...</span>
                          </div>
                        ) : (
                          'Connect Broker'
                        )}
                      </motion.button>
                    </div>
                  </form>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BrokerConnection;