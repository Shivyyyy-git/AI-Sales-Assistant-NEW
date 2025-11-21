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
