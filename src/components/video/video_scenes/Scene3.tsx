import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 1800),
      setTimeout(() => setPhase(3), 2800),
      setTimeout(() => setPhase(4), 4500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[10vw] bg-[#0f1117]"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="w-1/2">
        <motion.h2 
          className="text-[#4285f4] font-bold tracking-widest uppercase text-[1.5vw] mb-4"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
        >
          Sincronização Perfeita
        </motion.h2>
        
        <motion.h1 
          className="text-white font-bold text-[4.5vw] leading-tight mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
        >
          RCO Digital &<br/>Google Classroom
        </motion.h1>

        <motion.p
          className="text-[#e8e8f0]/70 text-[1.8vw] max-w-lg"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6 }}
        >
          Integração automática com o sistema oficial do estado. Notas, faltas e atividades fluem sem esforço.
        </motion.p>
      </div>

      <div className="w-[35vw] h-[35vw] relative flex items-center justify-center">
        {/* Central Hub */}
        <motion.div 
          className="absolute z-20 w-32 h-32 bg-[#4285f4] rounded-2xl flex items-center justify-center shadow-[0_0_50px_rgba(66,133,244,0.5)]"
          initial={{ scale: 0 }}
          animate={phase >= 1 ? { scale: 1 } : { scale: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <span className="text-white font-bold text-2xl">EduSync</span>
        </motion.div>

        {/* Connections */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 400">
          <motion.path 
            d="M 200 200 L 80 100" 
            stroke="#4285f4" strokeWidth="4" strokeDasharray="10 10"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={phase >= 2 ? { pathLength: 1, opacity: 0.5 } : { pathLength: 0, opacity: 0 }}
            transition={{ duration: 1 }}
          />
          <motion.path 
            d="M 200 200 L 320 100" 
            stroke="#4ade80" strokeWidth="4" strokeDasharray="10 10"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={phase >= 2 ? { pathLength: 1, opacity: 0.5 } : { pathLength: 0, opacity: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
          />
        </svg>

        {/* Nodes */}
        <motion.div 
          className="absolute top-[10%] left-[10%] w-24 h-24 bg-[#1a1d27] border border-[#4285f4]/50 rounded-xl flex items-center justify-center text-white font-bold"
          initial={{ scale: 0, x: 50, y: 50 }}
          animate={phase >= 2 ? { scale: 1, x: 0, y: 0 } : { scale: 0, x: 50, y: 50 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        >
          RCO
        </motion.div>

        <motion.div 
          className="absolute top-[10%] right-[10%] w-24 h-24 bg-[#1a1d27] border border-[#4ade80]/50 rounded-xl flex flex-col items-center justify-center text-white font-bold text-sm"
          initial={{ scale: 0, x: -50, y: 50 }}
          animate={phase >= 2 ? { scale: 1, x: 0, y: 0 } : { scale: 0, x: -50, y: 50 }}
          transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" className="mb-1"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
          Classroom
        </motion.div>

        {/* Data flowing particles */}
        {phase >= 3 && (
          <>
            <motion.div 
              className="absolute w-4 h-4 bg-white rounded-full shadow-[0_0_10px_white]"
              animate={{
                x: ['-120px', '0px'],
                y: ['-100px', '0px']
              }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            />
            <motion.div 
              className="absolute w-4 h-4 bg-white rounded-full shadow-[0_0_10px_white]"
              animate={{
                x: ['120px', '0px'],
                y: ['-100px', '0px']
              }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear", delay: 0.4 }}
            />
          </>
        )}
      </div>
    </motion.div>
  );
}
