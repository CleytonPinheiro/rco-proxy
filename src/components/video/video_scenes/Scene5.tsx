import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene5() {
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
      className="absolute inset-0 bg-[#0f1117] flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0, rotateY: -90 }}
      animate={{ opacity: 1, rotateY: 0 }}
      exit={{ y: '-100%', opacity: 0 }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
      style={{ perspective: 1000 }}
    >
      {/* Background isometric grid */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'linear-gradient(rgba(66, 133, 244, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(66, 133, 244, 0.1) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        transform: 'rotateX(60deg) scale(2)',
        transformOrigin: '50% 100%'
      }} />

      <div className="flex gap-20 relative z-10 w-[80vw]">
        {/* Student Portal */}
        <motion.div 
          className="flex-1"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          transition={{ duration: 0.8 }}
        >
          <div className="bg-[#1a1d27] rounded-2xl p-6 border border-[#4285f4]/30 shadow-2xl relative overflow-hidden h-[40vh]">
            <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
              <div className="w-10 h-10 rounded-full bg-[#4285f4]/20 flex items-center justify-center">
                <span className="text-xl">🎓</span>
              </div>
              <div>
                <h4 className="text-white font-bold">Portal do Aluno</h4>
                <p className="text-xs text-white/50">Acesso via celular</p>
              </div>
            </div>
            
            {phase >= 2 && (
              <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="h-8 bg-white/5 rounded-md w-full" />
                <div className="h-8 bg-white/5 rounded-md w-3/4" />
                <div className="h-8 bg-[#4ade80]/20 rounded-md w-1/2 border border-[#4ade80]/30" />
                
                <div className="mt-8 flex items-center gap-2 text-[#f59e0b] font-bold">
                  <span>⭐ Gamificação: +50 XP</span>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Pedagogical Portal */}
        <motion.div 
          className="flex-1 mt-12"
          initial={{ opacity: 0, x: 50 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: 50 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="bg-[#1a1d27] rounded-2xl p-6 border border-[#4ade80]/30 shadow-2xl relative overflow-hidden h-[40vh]">
            <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
              <div className="w-10 h-10 rounded-full bg-[#4ade80]/20 flex items-center justify-center">
                <span className="text-xl">📊</span>
              </div>
              <div>
                <h4 className="text-white font-bold">Painel Pedagógico</h4>
                <p className="text-xs text-white/50">Visão da Coordenação</p>
              </div>
            </div>
            
            {phase >= 3 && (
              <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="flex gap-4">
                  <div className="h-20 flex-1 bg-white/5 rounded-md" />
                  <div className="h-20 flex-1 bg-white/5 rounded-md" />
                </div>
                <div className="h-24 bg-white/5 rounded-md w-full flex items-end p-2 gap-2">
                  <div className="w-1/4 h-[40%] bg-[#4285f4]/50 rounded-sm" />
                  <div className="w-1/4 h-[70%] bg-[#4285f4]/50 rounded-sm" />
                  <div className="w-1/4 h-[90%] bg-[#4ade80]/50 rounded-sm" />
                  <div className="w-1/4 h-[50%] bg-[#4285f4]/50 rounded-sm" />
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      <motion.h2 
        className="absolute bottom-16 text-[3vw] text-white font-bold tracking-tight"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      >
        Transparência para toda a comunidade.
      </motion.h2>

    </motion.div>
  );
}
