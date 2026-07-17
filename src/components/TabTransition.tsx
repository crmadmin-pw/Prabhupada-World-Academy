import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TabTransitionProps {
  children: React.ReactNode;
  activeTab: string;
}

export default function TabTransition({ children, activeTab }: TabTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.18, ease: 'easeInOut' }}
        className="w-full h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
