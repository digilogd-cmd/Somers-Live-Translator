"use client";

import { useState, useRef, useCallback } from 'react';

// Helpers for PCM audio conversion
function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useGeminiLive() {
  const [isConnected, setIsConnected] = useState(false);
  const [subtitles, setSubtitles] = useState([]);
  
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const gainNodeRef = useRef(null);
  const filterNodeRef = useRef(null);
  const processorRef = useRef(null);
  const wsRef = useRef(null);

  const startListening = useCallback(async (boostLevel, targetLanguage) => {
    try {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        setSubtitles(prev => [...prev, "ERROR: API KEY NOT FOUND IN .env.local"]);
        return;
      }

      setSubtitles(prev => [...prev, "SYSTEM ACTIVATING... ESTABLISHING SECURE LINK."]);

      // 1. WebSocket Setup
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setSubtitles(prev => [...prev, "LINK ESTABLISHED. CONFIGURING TARGET LANGUAGE: " + targetLanguage]);
        
        // Setup System Instruction
        const instruction = targetLanguage === 'AUTO' 
          ? "You are Sommers, a real-time translator. Detect the spoken language and translate it to Korean instantly. Provide only the translation."
          : `You are Sommers. Translate all incoming ${targetLanguage} audio into Korean instantly. Provide only the translation.`;

        const setupMessage = {
          setup: {
            model: "models/gemini-2.0-flash-exp",
            systemInstruction: {
              parts: [{ text: instruction }]
            },
            generationConfig: {
              responseModalities: ["TEXT", "AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Aoede" // Choose a specific voice
                  }
                }
              }
            }
          }
        };
        ws.send(JSON.stringify(setupMessage));
        
        // Let user know we are ready
        setTimeout(() => {
          setSubtitles(prev => [...prev, "SOMMERS ACTIVE. INTERCEPTING AUDIO..."]);
          setIsConnected(true);
        }, 500);
      };

      ws.onmessage = async (event) => {
        try {
          // The API returns Blob (or JSON directly if not Blob, depending on env)
          let textData = event.data;
          if (event.data instanceof Blob) {
            textData = await event.data.text();
          }
          const response = JSON.parse(textData);

          if (response.serverContent?.modelTurn?.parts) {
            const parts = response.serverContent.modelTurn.parts;
            for (const part of parts) {
              // Handle Text
              if (part.text) {
                setSubtitles(prev => {
                  const newSubs = [...prev, part.text];
                  return newSubs.slice(-20); // Keep last 20 for waterfall UI
                });
              }
              // Handle Audio Response (Gemini's translated voice)
              if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
                const base64Audio = part.inlineData.data;
                const binaryString = atob(base64Audio);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                
                // Play audio
                if (audioContextRef.current) {
                  audioContextRef.current.decodeAudioData(bytes.buffer, (buffer) => {
                    const source = audioContextRef.current.createBufferSource();
                    source.buffer = buffer;
                    source.connect(audioContextRef.current.destination);
                    source.start(0);
                  }, (e) => console.error("Error decoding audio", e));
                }
              }
            }
          }
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setSubtitles(prev => [...prev, "SECURE LINK TERMINATED."]);
      };

      // 2. Audio Capture Setup
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000 // Gemini requires 16kHz
      });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);

      // Filter
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 300; 
      filterNodeRef.current = filter;

      // Gain
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = boostLevel;
      gainNodeRef.current = gainNode;

      // Processor
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(processor);
      processor.connect(audioCtx.destination); 

      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = floatTo16BitPCM(inputData);
          const base64Data = arrayBufferToBase64(pcmData);

          const mediaMessage = {
            realtimeInput: {
              mediaChunks: [{
                mimeType: "audio/pcm;rate=16000",
                data: base64Data
              }]
            }
          };
          ws.send(JSON.stringify(mediaMessage));
        }
      };

    } catch (err) {
      console.error("Audio/WS Setup Error:", err);
      setSubtitles(prev => [...prev, "CRITICAL ERROR: " + (err.message || "INITIALIZATION FAILED")]);
      setIsConnected(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (processorRef.current) processorRef.current.disconnect();
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(track => track.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    if (wsRef.current) wsRef.current.close();
    
    setIsConnected(false);
  }, []);

  const updateBoostLevel = (level) => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = level;
    }
  };

  return {
    isConnected,
    subtitles,
    startListening,
    stopListening,
    updateBoostLevel
  };
}
