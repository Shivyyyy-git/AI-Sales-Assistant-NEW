

import React, { useEffect, useRef, useState } from 'react';
import { TranscriptionEntry, ClientProfile, Community } from '../types';
import HighlightedText from './HighlightedText';

interface TranscriptionPanelProps {
  entries: TranscriptionEntry[];
  clientProfile: ClientProfile;
  suggestedQuestions: string[];
  agentGuidance: string[];
  isAgentAssistMode: boolean;
  communities: Community[];
}

const TranscriptionPanel: React.FC<TranscriptionPanelProps> = ({ entries, clientProfile, suggestedQuestions, agentGuidance, isAgentAssistMode, communities }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);

  // Auto-scroll to bottom if user hasn't scrolled up
  useEffect(() => {
    const element = scrollRef.current;
    if (element && !userHasScrolledUp) {
      // A small timeout allows the DOM to update before we scroll
      setTimeout(() => {
        element.scrollTop = element.scrollHeight;
      }, 50);
    }
  }, [entries, agentGuidance, suggestedQuestions, userHasScrolledUp]);

  // Listen to user scroll to pause/resume auto-scrolling
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      // Check if user is near the bottom (with a 5px tolerance)
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 5;
      setUserHasScrolledUp(!isAtBottom);
    };

    element.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      element.removeEventListener('scroll', handleScroll);
    };
  }, []); // Only run once on mount

  const keywords = React.useMemo(() => {
    // Extract keywords from client profile
    const profileKeywords = Object.values(clientProfile).filter(val => typeof val === 'string' && val.length > 1) as string[];

    // Extract names of partner communities
    const partnerNames = communities
      .filter(community => community.isPartner)
      .map(community => community.name);

    // Combine both lists, ensuring no duplicates
    return [...new Set([...profileKeywords, ...partnerNames])];
  }, [clientProfile, communities]);
  
  const handleScrollToBottom = () => {
    if (scrollRef.current) {
        scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth'
        });
    }
  };


  return (
    <div className="bg-white/90 backdrop-blur-lg border-2 border-gray-200/60 rounded-2xl p-6 lg:p-7 flex flex-col h-full min-h-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
       <div className="flex items-center justify-between mb-5 flex-shrink-0">
         <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mr-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            </div>
            <h2 className="text-xl lg:text-2xl font-bold text-gray-800">Conversation Stream</h2>
        </div>
      </div>
      <div ref={scrollRef} className="relative flex-grow overflow-y-auto min-h-0 bg-gradient-to-b from-gray-50/90 to-gray-50/60 p-5 rounded-xl border-2 border-gray-200/40 shadow-inner">
        {userHasScrolledUp && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
                <button 
                    onClick={handleScrollToBottom}
                    className="bg-blue-600/90 backdrop-blur-sm text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 hover:bg-blue-700 transition-all animate-bounce"
                    title="Scroll to most recent message"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                    New Messages
                </button>
            </div>
        )}
        <div className="space-y-4">
            {entries.length > 0 ? (
            entries.map((entry, index) => {
                const isUser = entry.speaker === 'user';
                const speakerLabel = isUser ? 'Client' : (isAgentAssistMode ? 'AI Guidance' : 'Assistant');
                const bubbleClasses = isUser 
                    ? 'bg-gray-200 text-gray-800 rounded-bl-none' 
                    : (isAgentAssistMode 
                        ? 'bg-purple-100 text-purple-800 rounded-br-none' 
                        : 'bg-blue-100 text-blue-800 rounded-br-none');

                return (
                <div key={index} className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
                    <div className="text-xs text-gray-500 mb-1 px-1 font-medium">{speakerLabel}</div>
                    <div className={`rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words max-w-[85%] ${bubbleClasses}`}>
                    <HighlightedText text={entry.text} keywords={keywords} isAgentAssistMode={isAgentAssistMode} />
                    </div>
                </div>
                );
            })
            ) : (
            <div className="flex items-center justify-center">
                <p className="text-gray-500 text-sm">Call transcript will appear here.</p>
            </div>
            )}
        </div>

        {(agentGuidance.length > 0 || suggestedQuestions.length > 0) && (
             <div className="flex-shrink-0 flex flex-col gap-4 pt-4 mt-4 border-t border-gray-200">
                {agentGuidance.length > 0 && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-2 uppercase tracking-wider flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0V6h-1a1 1 0 110-2h1V3a1 1 0 011-1zm-1 6a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zM12 13a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" clipRule="evenodd" />
                            </svg>
                            AI Agent Guidance
                        </h3>
                        <div className="space-y-2">
                            {agentGuidance.map((tip, index) => (
                                <div key={index} className="bg-purple-50 border border-purple-200/80 p-3 rounded-md text-purple-800">
                                    <p className="text-sm font-medium">{tip}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {suggestedQuestions.length > 0 && (
                    <div>
                        <h3 className="text-sm font-bold text-gray-500 mb-2 uppercase tracking-wider flex items-center">
                            <svg className="h-5 w-5 text-blue-500 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            AI Suggested Questions
                        </h3>
                        <div className="space-y-2">
                            {suggestedQuestions.map((q, index) => (
                                <div key={index} className="bg-blue-50 border border-blue-200/80 p-3 rounded-md text-blue-700">
                                    <p className="text-sm font-medium">{q}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

export default TranscriptionPanel;
