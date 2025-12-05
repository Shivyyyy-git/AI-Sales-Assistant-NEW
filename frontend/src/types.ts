export interface ClientProfile {
  name?: string;
  budget?: string;
  location?: string;
  careLevel?: string;
  timeline?: string;
  mobilityNeeds?: string;
  wheelchairAccessible?: boolean;
  specificDemands?: string;
}

export interface Community {
  id: number;
  name: string;
  location: string; // e.g., City, State
  address: string; // Full street address
  description: string;
  careLevels: string[];
  basePrice: number;
  pricingDetails: string; // e.g., "Studios from $5,500, one-bedrooms from $7,000"
  isPartner: boolean;
  amenities: string[];
  lat: number;
  lng: number;
  wheelchairAccessible: boolean;
  hasKitchen: boolean;
  availability: 'Immediate' | 'Waitlist' | 'Available Soon';
}

export interface Recommendation {
  name: string;
  reason: string;
  price?: string;
  careLevels?: string[];
  amenities?: string[];
  address?: string;
  description?: string;
}

export interface TranscriptionEntry {
  speaker: 'user' | 'model';
  text: string;
}

export enum CallStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  PROCESSING = 'PROCESSING',
  ERROR = 'ERROR',
}

export interface CallSummary {
    date: string;
    summary: string;
}

export interface User {
  name: string;
  title?: string;
  avatar: string; // A string for initials, e.g., "AC"
}

export type SupportedLanguage = 'en' | 'hi' | 'es';

export interface LanguageConfig {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
}

export interface ClientProfileSource {
  name?: string;
  client_name?: string;
  budget?: number | string;
  client_budget?: number | string;
  monthlyBudget?: number;
  specificDemands?: string;
  special_needs?: {
    other?: string;
  };
  notes?: string;
  wheelchairAccessible?: boolean;
  wheelchair_accessible?: boolean;
  location?: string;
  location_preference?: string;
  careLevel?: string;
  care_level?: string;
  timeline?: string;
  [key: string]: unknown;
}

export interface RecommendationKeyMetrics {
  monthly_fee?: number;
  distance_miles?: number;
  est_waitlist?: string;
  care_level?: string;
  zip_code?: string;
}

export interface RecommendationExplanations {
  holistic_reason?: string;
  availability_reason?: string;
  business_reason?: string;
  total_cost_reason?: string;
  distance_reason?: string;
  budget_efficiency_reason?: string;
  amenity_reason?: string;
  [key: string]: unknown;
}

export interface BackendRecommendation {
  community_name?: string;
  name?: string;
  community_id?: string | number;
  explanations?: RecommendationExplanations;
  key_metrics?: RecommendationKeyMetrics;
  careLevels?: string[];
  amenities?: string[];
  reason?: string;
  price?: string;
  address?: string;
  description?: string;
  [key: string]: unknown;
}

export interface PerformanceMetrics {
  api_calls?: number;
  timings?: {
    e2e_total?: number;
    phase1_extraction?: number;
    phase2_filtering?: number;
    phase3_ranking?: number;
    geocoding?: number;
  };
  token_counts?: {
    total_tokens?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
  };
  costs?: {
    total_cost?: number;
    extraction_cost?: number;
    ranking_cost?: number;
  };
}

export interface AnalysisResult {
  client_info?: ClientProfileSource;
  recommendations?: BackendRecommendation[];
  performance_metrics?: PerformanceMetrics;
  summary?: string;
  [key: string]: unknown;
}
