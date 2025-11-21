import React, { useEffect, useMemo, useState } from 'react';

interface FullRecommendationsDisplayProps {
  results: any;
}

const formatCurrency = (value?: number | string | null, digits = 0) => {
  const numericValue =
    typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) :
    typeof value === 'number' ? value :
    null;

  if (numericValue === null || Number.isNaN(numericValue)) return '—';

  return numericValue.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatMiles = (value?: number | null) => {
  if (typeof value !== 'number') return '—';
  return `${value.toFixed(1)} mi`;
};

const DIMENSION_LABELS: Record<string, string> = {
  business_reason: 'Business Priority',
  total_cost_reason: 'Total Cost',
  distance_reason: 'Distance',
  availability_reason: 'Availability',
  budget_efficiency_reason: 'Budget Efficiency',
  amenity_reason: 'Amenity Fit',
  holistic_reason: 'Holistic Fit',
};

export const FullRecommendationsDisplay: React.FC<FullRecommendationsDisplayProps> = ({ results }) => {
  const recommendations = results?.recommendations || [];
  const clientInfo = results?.client_info || {};
  const hasData = recommendations.length > 0;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = recommendations[selectedIndex] || null;

  const dimensionEntries = useMemo(() => {
    if (!selected?.explanations || !selected?.rankings) return [];
    return Object.entries(DIMENSION_LABELS).map(([key, label]) => {
      const explanation = selected.explanations?.[key];
      const rankKey = key.replace('_reason', '_rank');
      const rank = selected.rankings?.[rankKey];
      return {
        key,
        label,
        rank: typeof rank === 'number' ? `#${rank}` : '—',
        explanation: explanation || 'No explanation provided.',
      };
    });
  }, [selected]);

  useEffect(() => {
    if (selectedIndex >= recommendations.length) {
      setSelectedIndex(0);
    }
  }, [recommendations.length, selectedIndex]);

  if (!hasData) {
    return (
      <div className="bg-white/90 border border-dashed border-gray-300 rounded-2xl p-6 shadow-sm h-full flex flex-col justify-center text-center">
        <h3 className="text-xl font-semibold text-gray-800 mb-2">8-Dimensional Ranking</h3>
        <p className="text-gray-500 text-base">
          Upload a call recording or paste a transcript to unlock dimensional scoring and decision rationale.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/95 border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">8-Dimensional Ranking</h3>
          <p className="text-sm text-gray-500">Click any community to explore its weighted rationale.</p>
        </div>
        <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-50 text-blue-600">
          {recommendations.length} matches
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm text-gray-700 mb-4">
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
          <p className="text-xs uppercase text-gray-500">Care Level</p>
          <p className="text-base font-semibold text-gray-900">{clientInfo.care_level || '—'}</p>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
          <p className="text-xs uppercase text-gray-500">Budget</p>
          <p className="text-base font-semibold text-gray-900">{formatCurrency(clientInfo.budget)}</p>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
          <p className="text-xs uppercase text-gray-500">Timeline</p>
          <p className="text-base font-semibold text-gray-900 capitalize">{clientInfo.timeline || '—'}</p>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
          <p className="text-xs uppercase text-gray-500">Location</p>
          <p className="text-base font-semibold text-gray-900">{clientInfo.location_preference || '—'}</p>
        </div>
          </div>

      <div className="flex flex-col xl:flex-row gap-4 flex-1 min-h-0">
        <div className="xl:w-44 flex-shrink-0">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Ranked Matches</div>
          <div className="flex xl:flex-col gap-3 overflow-x-auto xl:overflow-y-auto pb-1">
            {recommendations.map((rec: any, index: number) => (
              <button
                key={rec.community_id || index}
                onClick={() => setSelectedIndex(index)}
                className={`min-w-[160px] xl:min-w-0 xl:w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                  index === selectedIndex
                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                }`}
              >
                <p className="text-xs uppercase tracking-wide">Rank #{rec.final_rank || index + 1}</p>
                <p className="text-sm font-semibold truncate">{rec.community_name || `Community ${rec.community_id || index + 1}`}</p>
                <p className="text-xs text-gray-500">{formatCurrency(rec.key_metrics?.monthly_fee)}</p>
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-gray-100 bg-white shadow-inner">
            <div className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase text-gray-500">Currently Viewing</p>
                <h4 className="text-lg font-semibold text-gray-900">
                  {selected.community_name || `Community ${selected.community_id || selectedIndex + 1}`}
                </h4>
              </div>
              <div className="text-right text-sm text-gray-500">
                <p className="font-semibold text-gray-800">{formatCurrency(selected.key_metrics?.monthly_fee)}</p>
                <p>{selected.key_metrics?.est_waitlist || 'Availability N/A'}</p>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 text-sm text-gray-600">
              {dimensionEntries.map(entry => (
                <div key={entry.key} className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="font-semibold text-gray-800">{entry.label}</p>
                    <span className="text-xs font-semibold text-blue-600">{entry.rank}</span>
                  </div>
                  <p>{entry.explanation}</p>
        </div>
      ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-center text-gray-500">
            Select a community to see dimensional reasoning.
        </div>
      )}
      </div>
    </div>
  );
};
