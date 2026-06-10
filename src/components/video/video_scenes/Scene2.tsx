import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 3500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-[#4285f4]"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="text-center">
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={phase >= 1 ? { scale: 1, rotate: 0 } : { scale: 0, rotate: -180 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="mb-8 inline-block"
        >
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="white"></polygon>
          </svg>
        </motion.div>

        <motion.h1 
          className="text-[10vw] md:text-[8vw] font-black text-white tracking-tighter leading-none"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {'EduSync'.split('').map((char, i) => (
            <motion.span 
              key={i} 
              className="inline-block"
              initial={{ opacity: 0, y: 50, rotateX: 90 }}
              animate={phase >= 2 ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 50, rotateX: 90 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: i * 0.05 }}
            >
              {char}
            </motion.span>
          ))}
        </motion.h1>

        <motion.div 
          className="mt-6 text-[3vw] md:text-[2vw] text-white/90 font-medium tracking-wide"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6 }}
        >
          A plataforma que automatiza tudo.
        </motion.div>
      </div>
    </motion.div>
  );
}
