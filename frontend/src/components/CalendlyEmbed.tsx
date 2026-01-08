import React, { useEffect } from 'react';

interface CalendlyEmbedProps {
  url: string;
  onEventScheduled?: () => void;
  prefill?: {
    name?: string;
    email?: string;
    customAnswers?: Record<string, string>;
  };
}

/**
 * Calendly Embed Component
 * 
 * Usage:
 * <CalendlyEmbed 
 *   url="https://calendly.com/your-username/consultation"
 *   prefill={{ name: "John Doe", email: "john@example.com" }}
 *   onEventScheduled={() => console.log("Meeting booked!")}
 * />
 */
export const CalendlyEmbed: React.FC<CalendlyEmbedProps> = ({ 
  url, 
  onEventScheduled,
  prefill 
}) => {
  useEffect(() => {
    // Load Calendly widget script
    const script = document.createElement('script');
    script.src = 'https://assets.calendly.com/assets/external/widget.js';
    script.async = true;
    document.body.appendChild(script);

    // Listen for Calendly events
    const handleCalendlyEvent = (e: MessageEvent) => {
      if (e.data.event === 'calendly.event_scheduled' && onEventScheduled) {
        onEventScheduled();
      }
    };

    window.addEventListener('message', handleCalendlyEvent);

    return () => {
      document.body.removeChild(script);
      window.removeEventListener('message', handleCalendlyEvent);
    };
  }, [onEventScheduled]);

  // Build URL with prefill parameters
  const buildCalendlyUrl = () => {
    const baseUrl = url;
    const params = new URLSearchParams();
    
    if (prefill?.name) params.append('name', prefill.name);
    if (prefill?.email) params.append('email', prefill.email);
    if (prefill?.customAnswers) {
      Object.entries(prefill.customAnswers).forEach(([key, value]) => {
        params.append(key, value);
      });
    }
    
    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
  };

  return (
    <div 
      className="calendly-inline-widget w-full rounded-xl overflow-hidden"
      data-url={buildCalendlyUrl()}
      style={{ minWidth: '320px', height: '630px' }}
    />
  );
};

interface CalendlyButtonProps {
  url: string;
  text?: string;
  className?: string;
  prefill?: {
    name?: string;
    email?: string;
  };
}

/**
 * Calendly Popup Button
 * Opens Calendly in a popup modal when clicked
 */
export const CalendlyButton: React.FC<CalendlyButtonProps> = ({ 
  url, 
  text = "Book a Consultation",
  className = "",
  prefill
}) => {
  const handleClick = () => {
    // Build URL with prefill
    let calendlyUrl = url;
    if (prefill) {
      const params = new URLSearchParams();
      if (prefill.name) params.append('name', prefill.name);
      if (prefill.email) params.append('email', prefill.email);
      const queryString = params.toString();
      if (queryString) calendlyUrl += `?${queryString}`;
    }

    // Open Calendly popup
    // @ts-expect-error Calendly is loaded via script
    if (window.Calendly) {
      // @ts-expect-error Calendly is loaded via script
      window.Calendly.initPopupWidget({ url: calendlyUrl });
    } else {
      // Fallback: open in new tab
      window.open(calendlyUrl, '_blank');
    }
  };

  useEffect(() => {
    // Load Calendly widget script for popup functionality
    if (!document.querySelector('script[src*="calendly"]')) {
      const script = document.createElement('script');
      script.src = 'https://assets.calendly.com/assets/external/widget.js';
      script.async = true;
      document.body.appendChild(script);
    }
    
    // Load Calendly CSS
    if (!document.querySelector('link[href*="calendly"]')) {
      const link = document.createElement('link');
      link.href = 'https://assets.calendly.com/assets/external/widget.css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
  }, []);

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      {text}
    </button>
  );
};

export default CalendlyEmbed;
