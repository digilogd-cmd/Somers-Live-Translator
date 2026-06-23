"use client";

import { useState, useEffect } from 'react';
import { useGeminiLive } from '@/hooks/useGeminiLive';

export default function Home() {
  const { isConnected, subtitles: hookSubtitles, startListening, stopListening, updateBoostLevel } = useGeminiLive();
  const [language, setLanguage] = useState('AUTO');
  const [boostLevel, setBoostLevel] = useState(1);
  const [subtitles, setSubtitles] = useState([
    "SOMMERS SYSTEM INITIALIZED...",
    "WAITING FOR AUDIO INPUT..."
  ]);
  const [audioLevel, setAudioLevel] = useState(0);

  // Sync hook subtitles
  useEffect(() => {
    if (hookSubtitles.length > 0) {
      setSubtitles(prev => [...prev, hookSubtitles[hookSubtitles.length - 1]]);
    }
  }, [hookSubtitles]);

  // Sync boost level
  useEffect(() => {
    updateBoostLevel(boostLevel);
  }, [boostLevel, updateBoostLevel]);

  const toggleListen = () => {
    if (!isConnected) {
      startListening(boostLevel, language);
    } else {
      stopListening();
      setAudioLevel(0);
    }
  };

  // Dummy VU Meter effect for visual feedback
  useEffect(() => {
    let interval;
    if (isConnected) {
      interval = setInterval(() => {
        setAudioLevel(Math.random() * 100);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  return (
    <div className="device-container">
      {/* Waterfall UI Screen */}
      <div className="screen-container">
        {subtitles.map((text, i) => (
          <div key={i} className="teletype-text">
            {`> ${text}`}
          </div>
        ))}
      </div>

      {/* Control Panel */}
      <div className="controls-panel">
        {/* VU Meter */}
        <div className="vu-meter">
          <div className="vu-bar" style={{ width: `${audioLevel}%` }}></div>
        </div>

        {/* Language Selection */}
        <div className="radio-group">
          {['AUTO', 'EN', 'JA', 'ZH'].map(lang => (
            <button 
              key={lang}
              className={`radio-btn ${language === lang ? 'active' : ''}`}
              onClick={() => setLanguage(lang)}
            >
              {lang}
            </button>
          ))}
        </div>

        {/* Booster Slider */}
        <div className="booster-container">
          <span className="booster-label">GAIN</span>
          <input 
            type="range" 
            min="1" max="3" step="1" 
            value={boostLevel}
            onChange={(e) => setBoostLevel(parseInt(e.target.value))}
          />
          <span className="booster-label">{boostLevel}X</span>
        </div>

        {/* Main Toggle */}
        <button 
          className={`listen-toggle ${isConnected ? 'active' : ''}`}
          onClick={toggleListen}
        >
          {isConnected ? 'INTERCEPTING...' : 'ACTIVATE SOMMERS'}
        </button>
      </div>
    </div>
  );
}
