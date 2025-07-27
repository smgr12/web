import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, RefreshCw, Database, AlertCircle, CheckCircle } from 'lucide-react';
import { symbolsAPI } from '../../services/api';
import toast from 'react-hot-toast';

interface Symbol {
  symbol: string;
  name: string;
  exchange: string;
  segment: string;
  instrument_type: string;
  supported_brokers: string[];
  broker_tokens: string[];
}

interface SymbolSearchProps {
  onSymbolSelect: (symbol: Symbol) => void;
  selectedBroker?: string;
  placeholder?: string;
  className?: string;
}

const SymbolSearch: React.FC<SymbolSearchProps> = ({
  onSymbolSelect,
  selectedBroker,
  placeholder = "Search symbols...",
  className = ""
}) => {
  const [query, setQuery] = useState('');
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [syncStatus, setSyncStatus] = useState<any[]>([]);
  
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    fetchSyncStatus();
    
    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.length >= 3) {
      // Debounce search
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      
      debounceRef.current = setTimeout(() => {
        searchSymbols(query);
      }, 300);
    } else {
      setSymbols([]);
      setShowDropdown(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const fetchSyncStatus = async () => {
    try {
      const response = await symbolsAPI.getSyncStatus();
      setSyncStatus(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to fetch sync status:', error);
      setSyncStatus([]); // Ensure it's always an array
    }
  };

  const searchSymbols = async (searchQuery: string) => {
    if (searchQuery.length < 3) return;
    
    setLoading(true);
    try {
      // Use enhanced search for better results
      const response = await symbolsAPI.enhancedSymbolSearch(searchQuery, {
        broker: selectedBroker,
        limit: 20
      });
      setSymbols(response.data || []);
      setShowDropdown(true);
      setSelectedIndex(-1);
    } catch (error) {
      console.error('Failed to search symbols:', error);
      // Fallback to basic search
      try {
        const fallbackResponse = await symbolsAPI.searchSymbols(searchQuery, null, 20);
        setSymbols(fallbackResponse.data || []);
        setShowDropdown(true);
        setSelectedIndex(-1);
      } catch (fallbackError) {
        console.error('Fallback search also failed:', fallbackError);
        toast.error('Failed to search symbols');
        setSymbols([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || symbols.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < symbols.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : symbols.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < symbols.length) {
          handleSymbolSelect(symbols[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleSymbolSelect = (symbol: Symbol) => {
    setQuery(symbol.symbol);
    setShowDropdown(false);
    setSelectedIndex(-1);
    onSymbolSelect(symbol);
  };

  const clearSearch = () => {
    setQuery('');
    setSymbols([]);
    setShowDropdown(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const syncAllSymbols = async () => {
    try {
      await symbolsAPI.syncAllSymbols();
      toast.success('Symbol sync started for all brokers');
      fetchSyncStatus();
    } catch (error) {
      toast.error('Failed to start symbol sync');
    }
  };

  const getBrokerSupport = (symbol: Symbol) => {
    if (!selectedBroker) return null;
    
    const isSupported = symbol.supported_brokers.includes(selectedBroker);
    return {
      supported: isSupported,
      token: isSupported ? symbol.broker_tokens[symbol.supported_brokers.indexOf(selectedBroker)] : null
    };
  };

  const getExchangeColor = (exchange: string) => {
    switch (exchange) {
      case 'NSE': return 'bg-blue-100 text-blue-800';
      case 'BSE': return 'bg-green-100 text-green-800';
      case 'MCX': return 'bg-yellow-100 text-yellow-800';
      case 'NCDEX': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const needsSync = !Array.isArray(syncStatus) || syncStatus.length === 0 || syncStatus.some(s => s.sync_status !== 'completed');

  return (
    <div className={`relative ${className}`} ref={searchRef}>
      {/* Sync Status Banner */}
      {needsSync && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <span className="text-sm text-yellow-800">
                Symbol database needs synchronization for accurate mapping
              </span>
            </div>
            <button
              onClick={syncAllSymbols}
              className="flex items-center space-x-1 px-3 py-1 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Sync Now</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {loading ? (
            <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-gray-400" />
          )}
        </div>
        
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query.length >= 3 && setShowDropdown(true)}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        
        {query && (
          <button
            onClick={clearSearch}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
          >
            <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      {/* Search Results Dropdown */}
      <AnimatePresence>
        {showDropdown && symbols.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
          >
            {symbols.map((symbol, index) => {
              const brokerSupport = getBrokerSupport(symbol);
              
              return (
                <div
                  key={`${symbol.symbol}-${symbol.exchange}`}
                  onClick={() => handleSymbolSelect(symbol)}
                  className={`px-4 py-3 cursor-pointer border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${
                    index === selectedIndex ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">{symbol.symbol}</span>
                        <span className={`px-2 py-1 text-xs rounded-full ${getExchangeColor(symbol.exchange)}`}>
                          {symbol.exchange}
                        </span>
                        {selectedBroker && brokerSupport && (
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            brokerSupport.supported 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {brokerSupport.supported ? 'Supported' : 'Not Supported'}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {symbol.name}
                      </div>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className="text-xs text-gray-500">
                          {symbol.instrument_type} • {symbol.segment}
                        </span>
                        {selectedBroker && brokerSupport?.token && (
                          <span className="text-xs text-gray-500">
                            Token: {brokerSupport.token}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-1">
                      {symbol.supported_brokers.map((broker, idx) => (
                        <span
                          key={idx}
                          className={`px-2 py-1 text-xs rounded ${
                            broker === selectedBroker 
                              ? 'bg-blue-100 text-blue-800' 
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {broker}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* No Results */}
      {showDropdown && !loading && query.length >= 3 && symbols.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4"
        >
          <div className="text-center text-gray-500">
            <Database className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm">No symbols found for "{query}"</p>
            <p className="text-xs mt-1">Try a different search term or sync symbol database</p>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default SymbolSearch;