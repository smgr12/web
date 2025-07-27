import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, ChevronDown, TrendingUp, Building2, 
  Clock, Target, Zap, AlertCircle, Loader2
} from 'lucide-react';
import { symbolsAPI } from '../../services/api';
import toast from 'react-hot-toast';

interface Segment {
  segment: string;
  exchange: string;
  symbol_count: number;
  broker_count: number;
  supported_brokers: string[];
  display_name: string;
}

interface Symbol {
  id: number;
  symbol: string;
  name: string;
  exchange: string;
  segment: string;
  instrument_type: string;
  lot_size: number;
  tick_size: number;
  expiry_date?: string;
  strike_price?: number;
  option_type?: string;
  supported_brokers: string[];
  broker_tokens: string[];
  relevance_score: number;
}

interface SegmentSymbolSearchProps {
  onSymbolSelect: (symbol: Symbol) => void;
  placeholder?: string;
  className?: string;
}

const SegmentSymbolSearch: React.FC<SegmentSymbolSearchProps> = ({
  onSymbolSelect,
  placeholder = "First select segment, then search symbols...",
  className = ""
}) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [query, setQuery] = useState('');
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSegments, setLoadingSegments] = useState(true);
  const [showSegmentDropdown, setShowSegmentDropdown] = useState(false);
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  const debounceRef = useRef<NodeJS.Timeout>();
  const segmentDropdownRef = useRef<HTMLDivElement>(null);
  const symbolDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available segments on component mount
  useEffect(() => {
    fetchSegments();
  }, []);

  // Handle click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (segmentDropdownRef.current && !segmentDropdownRef.current.contains(event.target as Node)) {
        setShowSegmentDropdown(false);
      }
      if (symbolDropdownRef.current && !symbolDropdownRef.current.contains(event.target as Node)) {
        setShowSymbolDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced symbol search
  useEffect(() => {
    if (selectedSegment && query.length >= 3) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      
      debounceRef.current = setTimeout(() => {
        searchSymbols(query);
      }, 300);
    } else {
      setSymbols([]);
      setShowSymbolDropdown(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, selectedSegment]);

  const fetchSegments = async () => {
    try {
      setLoadingSegments(true);
      const response = await symbolsAPI.getAvailableSegments();
      setSegments(response.data || []);
    } catch (error) {
      console.error('Failed to fetch segments:', error);
      toast.error('Failed to load segments');
      setSegments([]);
    } finally {
      setLoadingSegments(false);
    }
  };

  const searchSymbols = async (searchQuery: string) => {
    if (!selectedSegment || searchQuery.length < 3) return;
    
    setLoading(true);
    try {
      const response = await symbolsAPI.searchSymbolsBySegment(
        searchQuery, 
        selectedSegment.segment,
        {
          exchange: selectedSegment.exchange,
          limit: 20
        }
      );
      setSymbols(response.data || []);
      setShowSymbolDropdown(true);
      setSelectedIndex(-1);
    } catch (error) {
      console.error('Failed to search symbols:', error);
      toast.error('Failed to search symbols');
      setSymbols([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSegmentSelect = (segment: Segment) => {
    setSelectedSegment(segment);
    setShowSegmentDropdown(false);
    setQuery('');
    setSymbols([]);
    setShowSymbolDropdown(false);
    toast.success(`Selected ${segment.display_name}`);
  };

  const handleSymbolSelect = (symbol: Symbol) => {
    onSymbolSelect(symbol);
    setQuery(symbol.symbol);
    setShowSymbolDropdown(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSymbolDropdown || symbols.length === 0) return;

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
        setShowSymbolDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const getSegmentIcon = (segment: string, exchange: string) => {
    if (exchange === 'NSE' || exchange === 'BSE') {
      return <Building2 className="w-4 h-4 text-blue-600" />;
    } else if (exchange === 'NFO' || exchange === 'BFO' || exchange === 'MCX') {
      return <TrendingUp className="w-4 h-4 text-orange-600" />;
    } else if (exchange === 'CDS') {
      return <Target className="w-4 h-4 text-green-600" />;
    }
    return <Zap className="w-4 h-4 text-purple-600" />;
  };

  const getInstrumentTypeColor = (type: string) => {
    switch (type) {
      case 'EQ':
      case 'EQUITY':
        return 'bg-blue-100 text-blue-800';
      case 'FUT':
      case 'FUTURES':
        return 'bg-orange-100 text-orange-800';
      case 'CE':
      case 'PE':
      case 'OPTIONS':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Segment Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-bronze-700 mb-2">
          Select Trading Segment
        </label>
        <div className="relative" ref={segmentDropdownRef}>
          <button
            onClick={() => setShowSegmentDropdown(!showSegmentDropdown)}
            disabled={loadingSegments}
            className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-300 rounded-lg hover:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center space-x-3">
              {selectedSegment ? (
                <>
                  {getSegmentIcon(selectedSegment.segment, selectedSegment.exchange)}
                  <div className="text-left">
                    <div className="font-medium text-gray-900">
                      {selectedSegment.display_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {selectedSegment.symbol_count.toLocaleString()} symbols • {selectedSegment.broker_count} brokers
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {loadingSegments ? (
                    <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                  ) : (
                    <Building2 className="w-4 h-4 text-gray-400" />
                  )}
                  <span className="text-gray-500">
                    {loadingSegments ? 'Loading segments...' : 'Choose a trading segment'}
                  </span>
                </>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${
              showSegmentDropdown ? 'rotate-180' : ''
            }`} />
          </button>

          {/* Segment Dropdown */}
          <AnimatePresence>
            {showSegmentDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
              >
                {segments.length > 0 ? (
                  segments.map((segment, index) => (
                    <motion.button
                      key={`${segment.exchange}-${segment.segment}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => handleSegmentSelect(segment)}
                      className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-100 last:border-b-0"
                    >
                      {getSegmentIcon(segment.segment, segment.exchange)}
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {segment.display_name}
                        </div>
                        <div className="text-xs text-gray-500 flex items-center space-x-4">
                          <span>{segment.symbol_count.toLocaleString()} symbols</span>
                          <span>{segment.broker_count} brokers</span>
                          <div className="flex space-x-1">
                            {segment.supported_brokers.slice(0, 3).map((broker, idx) => (
                              <span key={idx} className="px-1 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                                {broker}
                              </span>
                            ))}
                            {segment.supported_brokers.length > 3 && (
                              <span className="text-gray-400">+{segment.supported_brokers.length - 3}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-center text-gray-500">
                    <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                    No segments available
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Symbol Search */}
      <div className="relative" ref={symbolDropdownRef}>
        <label className="block text-sm font-medium text-bronze-700 mb-2">
          Search Symbols {selectedSegment && `in ${selectedSegment.display_name}`}
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => query.length >= 3 && selectedSegment && setShowSymbolDropdown(true)}
            disabled={!selectedSegment}
            placeholder={selectedSegment ? "Type 3+ letters to search symbols..." : "Select a segment first"}
            className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
          />
          
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 animate-spin text-blue-500" />
          )}
        </div>

        {/* Symbol Search Results */}
        <AnimatePresence>
          {showSymbolDropdown && symbols.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute z-40 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
            >
              {symbols.map((symbol, index) => (
                <motion.button
                  key={symbol.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => handleSymbolSelect(symbol)}
                  className={`w-full flex items-center justify-between px-4 py-3 hover:bg-blue-50 transition-colors text-left border-b border-gray-100 last:border-b-0 ${
                    selectedIndex === index ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-bold text-gray-900">{symbol.symbol}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${getInstrumentTypeColor(symbol.instrument_type)}`}>
                        {symbol.instrument_type}
                      </span>
                      {symbol.expiry_date && (
                        <span className="flex items-center space-x-1 text-xs text-gray-500">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(symbol.expiry_date).toLocaleDateString()}</span>
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 truncate">
                      {symbol.name || 'No description available'}
                    </div>
                    <div className="flex items-center space-x-4 mt-1">
                      <span className="text-xs text-gray-500">
                        Lot: {symbol.lot_size}
                      </span>
                      <span className="text-xs text-gray-500">
                        Tick: {symbol.tick_size}
                      </span>
                      {symbol.strike_price && (
                        <span className="text-xs text-gray-500">
                          Strike: ₹{symbol.strike_price}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end space-y-1">
                    <div className="flex space-x-1">
                      {symbol.supported_brokers.slice(0, 2).map((broker, idx) => (
                        <span key={idx} className="px-1 py-0.5 bg-green-100 text-green-800 text-xs rounded">
                          {broker}
                        </span>
                      ))}
                      {symbol.supported_brokers.length > 2 && (
                        <span className="text-xs text-gray-400">+{symbol.supported_brokers.length - 2}</span>
                      )}
                    </div>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* No Results */}
        {showSymbolDropdown && !loading && query.length >= 3 && symbols.length === 0 && selectedSegment && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute z-40 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center"
          >
            <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600">No symbols found for "{query}" in {selectedSegment.display_name}</p>
            <p className="text-sm text-gray-500 mt-1">Try a different search term</p>
          </motion.div>
        )}
      </div>

      {/* Selected Segment Info */}
      {selectedSegment && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {getSegmentIcon(selectedSegment.segment, selectedSegment.exchange)}
              <span className="font-medium text-blue-800">
                {selectedSegment.display_name}
              </span>
            </div>
            <div className="text-sm text-blue-600">
              {selectedSegment.symbol_count.toLocaleString()} symbols available
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default SegmentSymbolSearch;