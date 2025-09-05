
import React from 'react';
import { LearningMode, PanelConfig } from '../types';

interface TabsProps {
  activeMode: LearningMode;
  onModeChange: (mode: LearningMode) => void;
  configs: PanelConfig[];
}

const Tabs: React.FC<TabsProps> = ({ activeMode, onModeChange, configs }) => {
  return (
    <div className="flex justify-center border-b border-slate-800">
      <nav className="flex space-x-2 p-2 bg-slate-800/50 rounded-lg" aria-label="Tabs">
        {configs.map((config) => (
          <button
            key={config.mode}
            onClick={() => onModeChange(config.mode)}
            className={`
              flex items-center px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200
              ${
                activeMode === config.mode
                  ? 'bg-sky-500 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-700'
              }
            `}
          >
            <config.Icon className="w-5 h-5 mr-2" />
            {config.title}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Tabs;
