

import React, { useState } from 'react';
import { ClientProfile, CallSummary } from '../types';

interface ClientProfileCardProps {
  profile: ClientProfile;
  callHistory?: CallSummary[];
  onViewHistorySummary?: (summary: string) => void;
  isHistoryLoading?: boolean;
}

// FIX: Changed icon type from JSX.Element to React.ReactNode to resolve namespace error.
const ProfileField: React.FC<{ label: string; value?: string | boolean; icon: React.ReactNode }> = ({ label, value, icon }) => {
    let displayValue: string;
    let isSet: boolean;

    if (typeof value === 'boolean') {
        displayValue = value ? 'Yes' : 'No';
        isSet = true;
    } else {
        displayValue = value || '';
        isSet = !!value;
    }
    
    return (
      <div className={`p-4 rounded-xl transition-all duration-300 flex items-center space-x-4 border ${isSet ? 'bg-blue-50/80 border-blue-200/60 shadow-sm' : 'bg-gray-50/60 border-gray-200/40'}`}>
         <div className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${isSet ? 'bg-blue-100 text-blue-600 shadow-sm' : 'bg-gray-200 text-gray-400'}`}>
            {icon}
        </div>
        <div className="flex-1 min-w-0">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</h3>
            {isSet ? (
            <p className="text-base font-semibold text-gray-800 truncate">{displayValue}</p>
            ) : (
            <p className="text-sm text-gray-400 italic">Listening...</p>
            )}
        </div>
      </div>
    );
}

const ClientProfileCard: React.FC<ClientProfileCardProps> = ({ 
  profile, 
  callHistory = [], 
  onViewHistorySummary,
  isHistoryLoading = false 
}) => {
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const clientName = profile.name || 'Client';
  const hasHistory = callHistory && callHistory.length > 0;

  const fields = [
    { key: 'name', label: 'Client Name', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg> },
    { key: 'budget', label: 'Budget', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01" /></svg> },
    { key: 'location', label: 'Location', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg> },
    { key: 'careLevel', label: 'Care Level', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg> },
    { key: 'timeline', label: 'Timeline', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
    { key: 'wheelchairAccessible', label: 'Wheelchair Access', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 100 2 1 1 0 000-2z" /><path fillRule="evenodd" d="M9 6.002a.997.997 0 00-1-.998H4.219a1 1 0 100 2H6v3.454a2.5 2.5 0 102 0V6.002zM10.25 15.5a1.25 1.25 0 10-2.5 0 1.25 1.25 0 002.5 0z" clipRule="evenodd" /><path d="M14.75 15.5a1.25 1.25 0 11-2.5 0 1.25 1.25 0 012.5 0zM14 9.412V6.002a.998.998 0 00-1.28-.962l-3.04 1.216a.998.998 0 00-.68.962v2.241a2.502 2.502 0 000 1.085v2.241c0 .416.257.784.631.93l3.089 1.236a1 1 0 001.28-.962V9.412z" /></svg> },
    { key: 'specificDemands', label: 'Specific Demands', icon: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 5a3 3 0 015-2.236A3 3 0 0114.83 6H16a2 2 0 110 4h-1.17a3 3 0 01-5.66 0H5a2 2 0 110-4h.17A3 3 0 015 5zm4.242 1.242a.5.5 0 01.708 0l1.25 1.25a.5.5 0 010 .708l-1.25 1.25a.5.5 0 01-.708-.708L9.293 8 8.043 6.75a.5.5 0 010-.708zM6.5 8a.5.5 0 000 1h.5a.5.5 0 000-1h-.5z" clipRule="evenodd" /></svg>},
  ];

  return (
    <div className="bg-white/90 backdrop-blur-lg border-2 border-gray-200/60 rounded-2xl p-6 lg:p-7 h-full shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col min-h-0">
      {/* Fixed Header Section */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mr-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            </div>
            <h2 className="text-xl lg:text-2xl font-bold text-gray-800">Client Profile</h2>
        </div>
      </div>
      
      {/* Scrollable Content Area */}
      <div className="flex-grow min-h-0 overflow-y-auto pr-2">
        {/* Completion Status Badges */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-6" aria-label="Client profile completion status">
        {fields.map(field => {
            const value = profile[field.key as keyof ClientProfile];
            const isComplete = typeof value === 'boolean' || (typeof value === 'string' && value.length > 0);
            return (
                <div
                    key={field.key}
                    title={`${field.label}: ${isComplete ? 'Complete' : 'Missing'}`}
                    className={`flex items-center text-xs font-semibold px-2.5 py-1 rounded-full transition-all duration-300 ${isComplete ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}
                >
                    {field.label}
                    {isComplete && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 ml-1.5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                    )}
                </div>
            )
        })}
       </div>
        
        {/* Profile Fields */}
        <div className="grid grid-cols-1 gap-3 mb-6">
        {fields.map(field => (
             <ProfileField key={field.key} label={field.label} value={profile[field.key as keyof ClientProfile]} icon={field.icon} />
        ))}
        </div>

        {/* Expandable Call History Section */}
        {profile.name && (
          <div className="pt-6 border-t-2 border-gray-200/60">
            <button
              onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
              className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md border-2 border-blue-200/60 hover:border-blue-300/80 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-gray-800">{clientName}'s Call History</p>
                  {hasHistory && (
                    <p className="text-xs text-gray-600 mt-0.5">{callHistory.length} {callHistory.length === 1 ? 'call' : 'calls'}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hasHistory && (
                  <span className="px-2.5 py-1 bg-blue-200 text-blue-700 text-xs font-semibold rounded-full">
                    {callHistory.length}
                  </span>
                )}
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className={`h-5 w-5 text-gray-600 transition-transform duration-200 ${isHistoryExpanded ? 'rotate-180' : ''}`} 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Expanded History Content */}
            {isHistoryExpanded && (
              <div className="mt-4 space-y-2">
                {isHistoryLoading ? (
                  <div className="flex justify-center items-center py-8">
                    <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                ) : hasHistory ? (
                  callHistory.map((item, index) => (
                    <button
                      key={index}
                      onClick={() => onViewHistorySummary?.(item.summary)}
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
                  <div className="text-center py-6 bg-gray-50/80 rounded-xl border-2 border-gray-200/40">
                    <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="mt-2 text-gray-500 text-sm">No call history yet</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientProfileCard;
