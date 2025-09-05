
import React from 'react';
import { SparklesIcon } from './common/Icon';

const Header: React.FC = () => {
  return (
    <header className="text-center py-8 px-4 border-b border-slate-800">
      <div className="inline-flex items-center justify-center bg-sky-500/10 text-sky-400 rounded-full p-3 mb-4">
        <SparklesIcon className="w-8 h-8"/>
      </div>
      <h1 className="text-4xl font-bold text-slate-100 tracking-tight">
        AI Learning Assistant
      </h1>
      <p className="mt-2 text-lg text-slate-400 max-w-2xl mx-auto">
        Your intelligent partner for accelerated learning. Ask questions, summarize documents, and clarify complex ideas instantly.
      </p>
    </header>
  );
};

export default Header;
