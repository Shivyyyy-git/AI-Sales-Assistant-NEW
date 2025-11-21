import React from 'react';
import { CallSummary } from '../types';

interface HistoryCardProps {
  history: CallSummary[];
  onViewSummary: (summary: string) => void;
  isLoading: boolean;
}

const HistoryCard: React.FC<HistoryCardProps> = ({ history, onViewSummary, isLoading }) => {
  return (
    <div className="bg-white/90 backdrop-blur-lg border-2 border-gray-200/60 rounded-2xl p-5 lg:p-6 h-full flex flex-col shadow-lg hover:shadow-xl transition-shadow duration-300">
      <div className="flex items-center mb-5 flex-shrink-0">
        <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center mr-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-lg lg:text-xl font-bold text-gray-800">Call History</h2>
      </div>
      <div className="space-y-2.5 flex-grow overflow-y-auto pr-2">
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : history.length > 0 ? (
          history.map((item, index) => (
            <button
              key={index}
              onClick={() => onViewSummary(item.summary)}
              className="w-full text-left bg-gray-50/90 hover:bg-blue-50/80 border-2 border-gray-200/60 hover:border-blue-300/80 p-3.5 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <p className="text-sm font-semibold text-gray-800 mb-1">
                Call on {new Date(item.date).toLocaleDateString()}
              </p>
              <p className="text-xs text-gray-500">
                {new Date(item.date).toLocaleTimeString()}
              </p>
            </button>
          ))
        ) : (
          <div className="text-center py-8 bg-gray-50/80 rounded-xl h-full flex flex-col justify-center items-center border-2 border-gray-200/40">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3v4M9 3v4M3 11h18" />
            </svg>
            <p className="mt-2 text-gray-500 text-sm">No saved call summaries.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryCard;