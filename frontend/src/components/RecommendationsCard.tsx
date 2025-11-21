

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Recommendation, Community } from '../types';

interface RecommendationsCardProps {
  recommendations: Recommendation[];
  allCommunities: Community[];
  onCompare: (communities: Community[]) => void;
  onPushToGoogleSheet?: () => void;
  onSendEmailToClient?: () => void;
  onSendEmailToManager?: () => void;
  onClear?: () => void;
}

const PartnerBadge: React.FC = () => (
    <div className="bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
        Partner
    </div>
);


const RecommendationsCard: React.FC<RecommendationsCardProps> = ({ 
  recommendations, 
  allCommunities, 
  onCompare,
  onPushToGoogleSheet,
  onSendEmailToClient,
  onSendEmailToManager,
  onClear,
}) => {
  const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);
  const [showEmailMenu, setShowEmailMenu] = useState(false);
  const emailMenuRef = useRef<HTMLDivElement>(null);

  // Close Excel/CRM menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emailMenuRef.current && !emailMenuRef.current.contains(event.target as Node)) {
        setShowEmailMenu(false);
      }
    };

    if (showEmailMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmailMenu]);

  const communitiesMap = useMemo(() => {
    const map = new Map<string, Community>();
    allCommunities.forEach(c => map.set(c.name, c));
    return map;
  }, [allCommunities]);
  
  const recommendedCommunities = useMemo(() => {
    return recommendations.map(r => communitiesMap.get(r.name)).filter(Boolean) as Community[];
  }, [recommendations, communitiesMap]);


  const handleSelectForComparison = (name: string) => {
    setSelectedForComparison(prev => {
        if(prev.includes(name)) {
            return prev.filter(item => item !== name);
        }
        if(prev.length < 2) {
            return [...prev, name];
        }
        return prev; // Do not allow more than 2 selections
    })
  }
  
  const handleCompareClick = () => {
    const communities = selectedForComparison.map(name => communitiesMap.get(name)).filter(Boolean) as Community[];
    if (communities.length === 2) {
        onCompare(communities);
    }
  }

  const findRecByName = (name: string) => recommendations.find(rec => rec.name === name);

  return (
    <div className="bg-white/90 backdrop-blur-lg border-2 border-gray-200/60 rounded-2xl p-6 lg:p-7 shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
      <div className="flex flex-col gap-3 mb-4 flex-shrink-0">
        <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mr-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            </div>
            <h2 className="text-xl lg:text-2xl font-bold text-gray-800">Top Recommendations</h2>
        </div>
      </div>

       <div className="flex flex-col gap-3 mb-4 flex-shrink-0">
         {/* Action Buttons Row - All using Compare Selected style */}
         <div className="flex flex-wrap justify-center gap-2.5">
           {/* Compare Selected Button - First */}
         <button
            onClick={handleCompareClick}
            disabled={selectedForComparison.length !== 2}
             className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 border border-transparent text-white hover:bg-blue-700 focus:ring-blue-500"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
               <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a1 1 0 011-1h14a1 1 0 110 2H3a1 1 0 01-1-1z" />
            </svg>
            Compare Selected ({selectedForComparison.length})
        </button>

           {/* Push to Google Sheet Button */}
           {onPushToGoogleSheet && (
             <button
               onClick={onPushToGoogleSheet}
               className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200 bg-green-600 border border-transparent text-white hover:bg-green-700 focus:ring-green-500"
               title="Push to Google Sheet"
             >
               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
               </svg>
               Push to Google Sheet
             </button>
           )}

           {/* Email Button with Dropdown */}
           {(onSendEmailToClient || onSendEmailToManager) && (
             <div className="relative" ref={emailMenuRef}>
               <button
                 onClick={() => setShowEmailMenu(!showEmailMenu)}
                 className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200 bg-blue-600 border border-transparent text-white hover:bg-blue-700 focus:ring-blue-500"
                 title="Send Email"
               >
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                 </svg>
                 Email
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                 </svg>
               </button>
               {showEmailMenu && (
                 <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-white border-2 border-gray-200 rounded-lg shadow-xl z-50 min-w-[200px]">
                   {onSendEmailToClient && (
                     <button
                       onClick={() => {
                         onSendEmailToClient();
                         setShowEmailMenu(false);
                       }}
                       className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors first:rounded-t-lg border-b border-gray-200"
                     >
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                       </svg>
                       <span className="font-medium text-gray-700">Email Client</span>
                     </button>
                   )}
                   {onSendEmailToManager && (
                     <button
                       onClick={() => {
                         onSendEmailToManager();
                         setShowEmailMenu(false);
                       }}
                       className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors last:rounded-b-lg"
                     >
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                       </svg>
                       <span className="font-medium text-gray-700">Email Manager</span>
                     </button>
                   )}
                 </div>
               )}
             </div>
           )}

           {/* Clear Recommendations Button */}
           {onClear && (
             <button
               onClick={onClear}
               className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-all duration-200 bg-red-600 border border-transparent text-white hover:bg-red-700 focus:ring-red-500"
               title="Clear all recommendations and client data"
             >
               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
               </svg>
               Clear Recommendations
             </button>
           )}
         </div>
      </div>

      <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
        {recommendations.length > 0 ? (
                recommendedCommunities.map((community, index) => {
                  const rec = findRecByName(community.name);
                  if (!rec) return null;

                  const isSelected = selectedForComparison.includes(rec.name);
                  const isPartner = community.isPartner;
                  const availability = community.availability;
                  
                  let availabilityColor = 'bg-gray-100 text-gray-700';
                  if(availability === 'Immediate') availabilityColor = 'bg-green-100 text-green-700';
                  if(availability === 'Waitlist') availabilityColor = 'bg-red-100 text-red-700';
                  if(availability === 'Available Soon') availabilityColor = 'bg-yellow-100 text-yellow-700';

                  return (
                    <div key={index} className={`border p-4 rounded-lg transition-all duration-300 relative ${isPartner ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'} ${isSelected ? 'shadow-lg ring-2 ring-offset-2 ring-offset-white ring-blue-500 border-blue-500' : 'hover:border-gray-300 hover:shadow-md'}`}>
                      <div className="flex justify-between items-start">
                          <h3 className="font-bold text-gray-800 text-lg flex items-center pr-24">
                            <input 
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mr-3 cursor-pointer"
                                  checked={isSelected}
                                  onChange={() => handleSelectForComparison(rec.name)}
                                  disabled={!isSelected && selectedForComparison.length >= 2}
                              />
                              {rec.name}
                          </h3>
                          {isPartner && <div className="absolute top-4 right-4"><PartnerBadge /></div>}
                      </div>
                      
                      <p className="text-gray-500 mt-1 text-sm ml-7">{rec.reason}</p>

                      <div className="mt-4 pt-3 border-t border-gray-200/80 text-sm space-y-2 ml-7">
                        <div className="flex items-center">
                          <span className="font-semibold w-28 text-gray-500">Availability:</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${availabilityColor}`}>{availability}</span>
                        </div>
                        {rec.price && (
                          <p className="text-gray-700 flex items-center">
                              <span className="font-semibold w-28 text-gray-500">Price:</span>
                              <span>{rec.price}</span>
                          </p>
                        )}
                        {rec.careLevels && rec.careLevels.length > 0 && (
                          <p className="text-gray-700 flex items-center">
                              <span className="font-semibold w-28 text-gray-500">Care Levels:</span>
                              <span className="flex flex-wrap gap-1">
                                  {rec.careLevels.map(level => <span key={level} className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full">{level}</span>)}
                              </span>
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })
        ) : (
          <div className="text-center py-12 bg-gray-50/80 rounded-lg border-2 border-dashed border-gray-200">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="mt-2 text-gray-600 font-semibold">Awaiting Recommendations</p>
            <p className="mt-1 text-gray-500 text-sm">Start a call to get AI-powered suggestions.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecommendationsCard;
