import React, { useMemo } from 'react';

interface RecommendationAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: Record<string, unknown> | null;
}

const DIMENSION_LABELS: Record<string, { label: string; icon: string; description: string }> = {
  business_reason: {
    label: 'Business Priority',
    icon: '💼',
    description: 'Revenue potential based on commission rates and partnership agreements'
  },
  total_cost_reason: {
    label: 'Total Cost Analysis',
    icon: '💰',
    description: 'Comprehensive cost including monthly fees and upfront charges'
  },
  distance_reason: {
    label: 'Geographic Proximity',
    icon: '📍',
    description: 'Distance from client\'s preferred location'
  },
  availability_reason: {
    label: 'Timeline Match',
    icon: '⏱️',
    description: 'How well the community\'s availability aligns with client timeline'
  },
  budget_efficiency_reason: {
    label: 'Budget Efficiency',
    icon: '💵',
    description: 'Value for money relative to client\'s budget'
  },
  couple_reason: {
    label: 'Couple Accommodation',
    icon: '👥',
    description: 'Suitability for couples or second-person needs'
  },
  amenity_reason: {
    label: 'Lifestyle & Amenities',
    icon: '🏊',
    description: 'Match between community amenities and client preferences'
  },
  holistic_reason: {
    label: 'Overall Fit',
    icon: '⭐',
    description: 'Comprehensive assessment of how well this community meets all client needs'
  },
};

export const RecommendationAnalysisModal: React.FC<RecommendationAnalysisModalProps> = ({
  isOpen,
  onClose,
  results
}) => {
  const recommendations = results?.recommendations || [];
  const clientInfo = results?.client_info || {};
  const hasData = recommendations.length > 0;

  const dimensionData = useMemo(() => {
    if (!hasData) return [];
    
    return recommendations.map((rec: Record<string, unknown>, recIndex: number) => {
      const dimensions = Object.entries(DIMENSION_LABELS).map(([key, config]) => {
        const explanation = rec.explanations?.[key];
        const rankKey = key.replace('_reason', '_rank');
        const rank = rec.rankings?.[rankKey];
        
        return {
          key,
          ...config,
          rank: typeof rank === 'number' ? rank : null,
          explanation: explanation || 'No detailed explanation available.',
          hasData: !!explanation
        };
      }).filter(d => d.hasData);

      return {
        communityName: rec.community_name || `Community ${rec.community_id || recIndex + 1}`,
        communityId: rec.community_id,
        finalRank: rec.final_rank || recIndex + 1,
        combinedScore: rec.combined_rank_score,
        monthlyFee: rec.key_metrics?.monthly_fee,
        distance: rec.key_metrics?.distance_miles,
        availability: rec.key_metrics?.est_waitlist,
        dimensions
      };
    });
  }, [hasData, recommendations]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-8 py-6 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">Recommendation Analysis</h2>
            <p className="text-blue-100 text-sm mt-1">Detailed rationale for client and manager review</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Client Summary */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-8 py-5 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Client Requirements</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Care Level</p>
              <p className="text-sm font-bold text-gray-900 mt-1">{clientInfo.care_level || '—'}</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Budget</p>
              <p className="text-sm font-bold text-gray-900 mt-1">
                {clientInfo.budget ? `$${clientInfo.budget.toLocaleString()}` : '—'}
              </p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Location</p>
              <p className="text-sm font-bold text-gray-900 mt-1">{clientInfo.location_preference || '—'}</p>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <p className="text-xs text-gray-500 uppercase font-medium">Timeline</p>
              <p className="text-sm font-bold text-gray-900 mt-1 capitalize">{clientInfo.timeline || '—'}</p>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {!hasData ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No recommendation data available.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {dimensionData.map((rec, recIndex) => (
                <div key={recIndex} className="bg-white border-2 border-gray-200 rounded-2xl p-6 shadow-lg">
                  {/* Community Header */}
                  <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-200">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 text-white font-bold text-lg">
                          #{rec.finalRank}
                        </span>
                        <div>
                          <h3 className="text-2xl font-bold text-gray-900">{rec.communityName}</h3>
                          <p className="text-sm text-gray-500 mt-1">Community ID: {rec.communityId}</p>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Combined Score</p>
                      <p className="text-3xl font-bold text-blue-600">{rec.combinedScore?.toFixed(1) || '—'}</p>
                      <p className="text-xs text-gray-400 mt-1">Lower is better</p>
                    </div>
                  </div>

                  {/* Key Metrics */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 rounded-lg p-4 text-center">
                      <p className="text-xs text-blue-600 uppercase font-semibold">Monthly Fee</p>
                      <p className="text-xl font-bold text-blue-900 mt-1">
                        ${rec.monthlyFee?.toLocaleString() || '—'}
                      </p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4 text-center">
                      <p className="text-xs text-green-600 uppercase font-semibold">Distance</p>
                      <p className="text-xl font-bold text-green-900 mt-1">
                        {rec.distance ? `${rec.distance.toFixed(1)} mi` : '—'}
                      </p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-4 text-center">
                      <p className="text-xs text-purple-600 uppercase font-semibold">Availability</p>
                      <p className="text-xl font-bold text-purple-900 mt-1">{rec.availability || '—'}</p>
                    </div>
                  </div>

                  {/* 8 Dimensions */}
                  <div>
                    <h4 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      8-Dimensional Analysis
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {rec.dimensions.map((dim) => (
                        <div
                          key={dim.key}
                          className="bg-gradient-to-br from-gray-50 to-white border-2 border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{dim.icon}</span>
                              <h5 className="font-bold text-gray-900">{dim.label}</h5>
                            </div>
                            {dim.rank !== null && (
                              <span className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                                #{dim.rank}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mb-2 italic">{dim.description}</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{dim.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-8 py-4 flex justify-between items-center">
          <p className="text-sm text-gray-600">
            This analysis provides detailed justification for client conversations and manager reviews.
          </p>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

