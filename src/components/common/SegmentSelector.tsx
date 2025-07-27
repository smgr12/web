import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Building2, TrendingUp, Target, Zap, Loader2 } from 'lucide-react';
import { symbolsAPI } from '../../services/api';

interface Segment {
  segment: string;
  exchange: string;
  symbol_count: number;
  broker_count: number;
  supported_brokers: string[];
  display_name: string;
}

interface SegmentSelectorProps {
  onSegmentSelect: (segment: Segment | null) => void;
  selectedSegment?: Segment | null;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const SegmentSelector: React.FC<SegmentSelectorProps> = ({
  onSegmentSelect,
  selectedSegment = null,
  placeholder = "Select trading segment",
  className = "",
  disabled = false
}) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetchSegments();
  }, []);

  const fetchSegments = async () => {
    try {
      setLoading(true);
      const response = await symbolsAPI.getAvailableSegments();
      setSegments(response.data || []);
    } catch (error) {
      console.error('Failed to fetch segments:', error);
      setSegments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSegmentSelect = (segment: Segment) => {
    onSegmentSelect(segment);
    setShowDropdown(false);
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

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => !disabled && setShowDropdown(!showDropdown)}
        disabled={disabled || loading}
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
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              ) : (
                <Building2 className="w-4 h-4 text-gray-400" />
              )}
              <span className="text-gray-500">
                {loading ? 'Loading segments...' : placeholder}
              </span>
            </>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${
          showDropdown ? 'rotate-180' : ''
        }`} />
      </button>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
          >
            {/* Clear Selection Option */}
            {selectedSegment && (
              <button
                onClick={() => handleSegmentSelect(null)}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 text-gray-500"
              >
                Clear selection
              </button>
            )}
            
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
                No segments available
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SegmentSelector;