import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene6() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f1117]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <div className="text-center relative z-10">
        <motion.div
          className="flex items-center justify-center gap-4 mb-8"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={phase >= 1 ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="#4285f4"></polygon>
          </svg>
          <h1 className="text-[6vw] font-black tracking-tighter" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-white">Edu</span><span className="text-[#4285f4]">Sync</span>
          </h1>
        </motion.div>

        <motion.div 
          className="h-px bg-gradient-to-r from-transparent via-[#4285f4] to-transparent w-full mb-8"
          initial={{ scaleX: 0 }}
          animate={phase >= 2 ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ duration: 1 }}
        />

        <motion.h2 
          className="text-[2.5vw] text-[#e8e8f0] font-medium max-w-4xl leading-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
        >
          Gestão escolar inteligente para professores do Paraná
        </motion.h2>
      </div>

      {/* Decorative pulse rings */}
      {phase >= 1 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <motion.div 
            className="w-[30vw] h-[30vw] rounded-full border border-[#4285f4]/30"
            initial={{ scale: 0.5, opacity: 1 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div 
            className="absolute top-0 left-0 w-[30vw] h-[30vw] rounded-full border border-[#4285f4]/30"
            initial={{ scale: 0.5, opacity: 1 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
          />
        </div>
      )}
    </motion.div>
  );
}
