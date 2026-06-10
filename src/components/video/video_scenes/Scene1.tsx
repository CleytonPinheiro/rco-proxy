import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f1117]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ scale: 1.5, opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative w-full max-w-4xl mx-auto px-8 text-center">
        
        {/* Floating papers/workload representation */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-24 h-32 bg-white/10 rounded border border-white/20"
              initial={{ 
                x: `${Math.random() * 100}vw`, 
                y: '100vh',
                rotate: Math.random() * 90 - 45
              }}
              animate={{ 
                y: '-20vh',
                rotate: Math.random() * 180 - 90
              }}
              transition={{ 
                duration: 4 + Math.random() * 3, 
                ease: "linear",
                delay: i * 0.4
              }}
            />
          ))}
        </div>

        <motion.h2 
          className="text-[4vw] md:text-[3vw] text-[#e8e8f0]/60 font-medium mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Professores do Paraná estão
        </motion.h2>

        <div className="overflow-hidden mb-8 py-2">
          <motion.h1 
            className="text-[8vw] md:text-[6vw] font-bold text-white leading-none tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
            initial={{ y: 100 }}
            animate={phase >= 1 ? { y: 0 } : { y: 100 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            SOBRECARREGADOS
          </motion.h1>
        </div>

        <div className="flex flex-wrap justify-center gap-4 mt-8">
          {['Lançamento no RCO', 'Correção de Provas', 'Gestão de Frequência', 'Relatórios'].map((item, i) => (
            <motion.div
              key={item}
              className="px-6 py-3 rounded-full bg-[#1a1d27] border border-red-500/30 text-red-400 font-medium text-[1.5vw] md:text-[1.2vw]"
              initial={{ scale: 0, opacity: 0 }}
              animate={phase >= 2 ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20, delay: i * 0.15 }}
            >
              {item}
            </motion.div>
          ))}
        </div>

      </div>
    </motion.div>
  );
}
