import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

const SCENE_DURATIONS = { 
  problem: 5000, 
  solution: 4500, 
  sync: 5500, 
  features: 6000, 
  portals: 5000,
  outro: 5000 
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0f1117]">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full opacity-10 blur-[100px]"
          style={{ background: 'radial-gradient(circle, #4285f4, transparent)' }}
          animate={{ 
            x: ['-20%', '20%', '-10%'], 
            y: ['-10%', '30%', '10%'],
            scale: [1, 1.2, 0.9]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="absolute w-[60vw] h-[60vw] rounded-full opacity-5 blur-[80px] right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #4ade80, transparent)' }}
          animate={{ 
            x: ['10%', '-30%', '5%'], 
            y: ['20%', '-20%', '0%']
          }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Persistent UI elements that move around */}
      <motion.div
        className="absolute z-10 hidden md:block"
        animate={{
          x: ['5vw', '10vw', '85vw', '50vw', '10vw', '50vw'][currentScene],
          y: ['10vh', '15vh', '10vh', '80vh', '80vh', '50vh'][currentScene],
          opacity: currentScene === 5 ? 0 : 0.5,
          scale: [1, 1.2, 0.8, 1.5, 1, 0][currentScene]
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4285f4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
      </motion.div>

      {/* Foreground Content */}
      <div className="absolute inset-0 z-20">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="problem" />}
          {currentScene === 1 && <Scene2 key="solution" />}
          {currentScene === 2 && <Scene3 key="sync" />}
          {currentScene === 3 && <Scene4 key="features" />}
          {currentScene === 4 && <Scene5 key="portals" />}
          {currentScene === 5 && <Scene6 key="outro" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
