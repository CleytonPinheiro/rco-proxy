import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1400),
      setTimeout(() => setPhase(3), 2200),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const features = [
    { title: "Correção Automática", desc: "Gabaritos lidos em segundos via GradePen", color: "#4285f4", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
    { title: "Boletim Inteligente", desc: "Cálculo automático de notas de recuperação", color: "#4ade80", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" },
    { title: "Frequência Real-time", desc: "Gestão de presenças com um clique", color: "#f59e0b", icon: "M12 20V10 M18 20V4 M6 20v-4" }
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f1117]"
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.h1 
        className="text-[4vw] font-bold text-white mb-16 text-center"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Tudo que você precisa em <span className="text-[#4285f4]">um só lugar</span>
      </motion.h1>

      <div className="flex gap-8 px-12 w-full max-w-[90vw]">
        {features.map((feat, i) => (
          <motion.div 
            key={i}
            className="flex-1 bg-[#1a1d27] border border-white/5 rounded-2xl p-8 relative overflow-hidden"
            initial={{ opacity: 0, y: 50 }}
            animate={phase >= i + 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          >
            {/* Top accent line */}
            <motion.div 
              className="absolute top-0 left-0 h-1"
              style={{ backgroundColor: feat.color }}
              initial={{ width: 0 }}
              animate={phase >= i + 1 ? { width: '100%' } : { width: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            />
            
            <div 
              className="w-16 h-16 rounded-xl flex items-center justify-center mb-6"
              style={{ backgroundColor: `${feat.color}20`, color: feat.color }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={feat.icon} />
              </svg>
            </div>
            
            <h3 className="text-white text-[2vw] font-bold mb-3">{feat.title}</h3>
            <p className="text-[#e8e8f0]/60 text-[1.2vw] leading-relaxed">{feat.desc}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
