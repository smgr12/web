import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Database, 
  RefreshCw, 
  Search, 
  Filter,
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { symbolsAPI } from '../../services/api';
import toast from 'react-hot-toast';
import { useDebounce } from 'use-debounce';
import ErrorBoundary from '../ErrorBoundary';

interface Symbol {
  id: string;
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SyncStatus {
  broker_name: string;
  is_syncing: boolean;
  last_sync_success: boolean;
  symbol_count: number;
  last_sync: string;
}

const PAGE_SIZE = 20;
const DEBOUNCE_DELAY = 300;

const SymbolsManagementContent: React.FC = () => {
  // State with enhanced initialization
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery] = useDebounce(searchQuery, DEBOUNCE_DELAY);
  const [selectedExchange, setSelectedExchange] = useState('');
  const [selectedSegment, setSelectedSegment] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Debugging logs
  useEffect(() => {
    console.log('Symbols data:', symbols);
    console.log('Sync status:', syncStatus);
  }, [symbols, syncStatus]);

  // Constants
  const exchanges = ['NSE', 'BSE', 'MCX', 'NCDEX'];
  const segments = ['EQ', 'FUT', 'OPT', 'COM'];

  // Memoized values with enhanced safety checks
  const filteredSymbols = useMemo(() => {
    if (!Array.isArray(symbols)) {
      console.error('Symbols is not an array:', symbols);
      return [];
    }

    return symbols.filter(symbol => {
      if (!symbol) return false;
      
      try {
        const matchesSearch = !debouncedSearchQuery || 
          String(symbol.symbol).toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
          String(symbol.name).toLowerCase().includes(debouncedSearchQuery.toLowerCase());
        
        const matchesExchange = !selectedExchange || symbol.exchange === selectedExchange;
        const matchesSegment = !selectedSegment || symbol.segment === selectedSegment;
        
        return matchesSearch && matchesExchange && matchesSegment;
      } catch (error) {
        console.error('Error filtering symbol:', symbol, error);
        return false;
      }
    });
  }, [symbols, debouncedSearchQuery, selectedExchange, selectedSegment]);

  const totalPages = useMemo(() => {
    return Math.ceil(totalCount / PAGE_SIZE);
  }, [totalCount]);

  // API Calls with enhanced error handling
  const fetchSymbols = useCallback(async () => {
    try {
      setLoading(true);
      const response = await symbolsAPI.getSymbols({
        search: debouncedSearchQuery,
        exchange: selectedExchange,
        segment: selectedSegment,
        limit: PAGE_SIZE,
        offset: (currentPage - 1) * PAGE_SIZE
      });
      
      // Ensure we always have an array
      const data = Array.isArray(response?.data) ? response.data : [];
      setSymbols(data);
      setTotalCount(response?.meta?.total_count || data.length);
    } catch (error: any) {
      console.error('Failed to fetch symbols:', error);
      toast.error(`Failed to fetch symbols: ${error.response?.data?.message || error.message}`);
      setSymbols([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [debouncedSearchQuery, selectedExchange, selectedSegment, currentPage]);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await symbolsAPI.getSyncStatus();
      setSyncStatus(Array.isArray(response?.data) ? response.data : []);
    } catch (error: any) {
      console.error('Failed to fetch sync status:', error);
      toast.error(`Failed to fetch sync status: ${error.response?.data?.message || error.message}`);
      setSyncStatus([]);
    }
  }, []);

  const handleSync = async (brokerName: string) => {
    try {
      setLoading(true);
      await symbolsAPI.syncSymbols(brokerName);
      toast.success(`Successfully synced symbols for ${brokerName}`);
      await Promise.all([fetchSymbols(), fetchSyncStatus()]);
    } catch (error: any) {
      console.error(`Failed to sync symbols for ${brokerName}:`, error);
      toast.error(`Failed to sync symbols: ${error.response?.data?.message || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Effects with cleanup
  useEffect(() => {
    const loadData = async () => {
      await Promise.all([fetchSymbols(), fetchSyncStatus()]);
    };
    loadData();

    return () => {
      // Cleanup if needed
    };
  }, [fetchSymbols, fetchSyncStatus]);

  useEffect(() => {
    // Reset to first page when filters change
    setCurrentPage(1);
  }, [debouncedSearchQuery, selectedExchange, selectedSegment]);

  // Handlers
  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedExchange('');
    setSelectedSegment('');
    setCurrentPage(1);
  };

  // Render helpers
  const renderLoadingSkeleton = () => (
    <tr>
      <td colSpan={8} className="px-4 py-6">
        <div className="flex flex-col items-center justify-center space-y-2">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-500" />
          <p className="text-bronze-600">Loading symbols...</p>
        </div>
      </td>
    </tr>
  );

  const renderEmptyState = () => (
    <tr>
      <td colSpan={8} className="px-4 py-8 text-center">
        <div className="flex flex-col items-center justify-center space-y-2">
          <Database className="w-8 h-8 text-bronze-400" />
          <p className="text-bronze-600 font-medium">No symbols found</p>
          {(debouncedSearchQuery || selectedExchange || selectedSegment) && (
            <button
              onClick={handleResetFilters}
              className="text-amber-600 hover:text-amber-700 font-medium"
            >
              Reset filters
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-bronze-800">Symbols Management</h1>
          <p className="text-bronze-600 mt-1">Manage and sync trading symbols across brokers</p>
        </div>
        
        <motion.button
          onClick={() => Promise.all([fetchSymbols(), fetchSyncStatus()])}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          disabled={loading}
          className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-bronze-600 text-white rounded-lg shadow-3d hover:shadow-3d-hover disabled:opacity-50"
          aria-label="Refresh data"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </motion.button>
      </div>

      {/* Sync Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {syncStatus.map((status, index) => (
          <motion.div
            key={status.broker_name || index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-white/90 backdrop-blur-sm rounded-xl shadow-3d p-4 border border-beige-200"
            aria-labelledby={`sync-status-${status.broker_name}`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 id={`sync-status-${status.broker_name}`} className="font-semibold text-bronze-800">
                {status.broker_name || 'Unknown'}
              </h3>
              {status.is_syncing ? (
                <RefreshCw className="w-4 h-4 text-amber-500 animate-spin" aria-hidden="true" />
              ) : status.last_sync_success ? (
                <CheckCircle className="w-4 h-4 text-green-500" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-500" aria-hidden="true" />
              )}
            </div>
            
            <div className="text-sm text-bronze-600 space-y-1">
              <p>Symbols: {status.symbol_count || 0}</p>
              <p>Last Sync: {status.last_sync ? new Date(status.last_sync).toLocaleString() : 'Never'}</p>
            </div>
            
            <motion.button
              onClick={() => handleSync(status.broker_name)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={loading || status.is_syncing}
              className="mt-3 w-full px-3 py-1 bg-beige-100 text-bronze-700 rounded-lg text-sm hover:bg-beige-200 disabled:opacity-50"
              aria-label={`Sync symbols for ${status.broker_name}`}
            >
              {status.is_syncing ? 'Syncing...' : 'Sync Now'}
            </motion.button>
          </motion.div>
        ))}
      </div>

      {/* Search and Filters */}
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-3d p-4 border border-beige-200">
        <div className="flex items-center space-x-4 mb-4">
          <div className="flex-1 relative">
            <label htmlFor="symbol-search" className="sr-only">Search symbols</label>
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-bronze-400" />
            <input
              id="symbol-search"
              type="text"
              placeholder="Search symbols..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-beige-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              aria-label="Search symbols"
            />
          </div>
          
          <div className="flex space-x-2">
            <motion.button
              onClick={() => setShowFilters(!showFilters)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center space-x-2 px-4 py-2 border border-beige-300 rounded-lg hover:bg-beige-50"
              aria-expanded={showFilters}
              aria-controls="filters-section"
            >
              <Filter className="w-4 h-4" />
              <span>Filters</span>
            </motion.button>

            {(searchQuery || selectedExchange || selectedSegment) && (
              <button
                onClick={handleResetFilters}
                className="px-3 py-2 text-sm text-bronze-600 hover:text-bronze-800"
                aria-label="Reset filters"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {showFilters && (
          <motion.div
            id="filters-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-beige-200"
          >
            <div>
              <label htmlFor="exchange-filter" className="block text-sm font-medium text-bronze-700 mb-1">
                Exchange
              </label>
              <select
                id="exchange-filter"
                value={selectedExchange}
                onChange={(e) => setSelectedExchange(e.target.value)}
                className="w-full px-3 py-2 border border-beige-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                aria-label="Filter by exchange"
              >
                <option value="">All Exchanges</option>
                {exchanges.map(exchange => (
                  <option key={exchange} value={exchange}>{exchange}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label htmlFor="segment-filter" className="block text-sm font-medium text-bronze-700 mb-1">
                Segment
              </label>
              <select
                id="segment-filter"
                value={selectedSegment}
                onChange={(e) => setSelectedSegment(e.target.value)}
                className="w-full px-3 py-2 border border-beige-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                aria-label="Filter by segment"
              >
                <option value="">All Segments</option>
                {segments.map(segment => (
                  <option key={segment} value={segment}>{segment}</option>
                ))}
              </select>
            </div>
          </motion.div>
        )}
      </div>

      {/* Symbols Table */}
      <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-3d border border-beige-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-beige-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-bronze-800">
            Symbols ({totalCount})
          </h2>
          <div className="flex space-x-2">
            <button className="p-2 text-bronze-600 hover:text-bronze-800 hover:bg-beige-100 rounded">
              <Download className="w-4 h-4" />
            </button>
            <button className="p-2 text-bronze-600 hover:text-bronze-800 hover:bg-beige-100 rounded">
              <Upload className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-beige-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Exchange</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Segment</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Lot Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Brokers</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-bronze-700 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-beige-200">
              {initialLoad ? renderLoadingSkeleton() : 
               filteredSymbols.length === 0 ? renderEmptyState() : 
               filteredSymbols.map((symbol, index) => (
                <motion.tr
                  key={symbol.id || index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-beige-50"
                >
                  <td className="px-4 py-3 text-sm font-medium text-bronze-800">{symbol.symbol}</td>
                  <td className="px-4 py-3 text-sm text-bronze-600">{symbol.name}</td>
                  <td className="px-4 py-3 text-sm text-bronze-600">{symbol.exchange}</td>
                  <td className="px-4 py-3 text-sm text-bronze-600">{symbol.segment}</td>
                  <td className="px-4 py-3 text-sm text-bronze-600">{symbol.instrument_type}</td>
                  <td className="px-4 py-3 text-sm text-bronze-600">{symbol.lot_size}</td>
                  <td className="px-4 py-3 text-sm text-bronze-600">
                    <div className="flex flex-wrap gap-1">
                      {symbol.supported_brokers?.map(broker => (
                        <span key={broker} className="px-2 py-1 bg-beige-100 text-bronze-700 rounded text-xs">
                          {broker}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {symbol.is_active ? (
                      <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs">
                        <X className="w-3 h-3 mr-1" />
                        Inactive
                      </span>
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-beige-200 flex items-center justify-between">
            <div className="text-sm text-bronze-600">
              Showing page {currentPage} of {totalPages}
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 border border-beige-300 rounded hover:bg-beige-50 disabled:opacity-50"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`w-10 h-10 rounded ${currentPage === pageNum ? 'bg-amber-500 text-white' : 'hover:bg-beige-50'}`}
                    aria-label={`Go to page ${pageNum}`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 border border-beige-300 rounded hover:bg-beige-50 disabled:opacity-50"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Wrap the component with ErrorBoundary
const SymbolsManagement: React.FC = () => (
  <ErrorBoundary>
    <SymbolsManagementContent />
  </ErrorBoundary>
);

export default SymbolsManagement;