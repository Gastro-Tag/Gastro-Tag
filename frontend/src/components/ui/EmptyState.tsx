import { ReactNode } from 'react';

interface EmptyStateProps {
  icon:     ReactNode;
  title:    string;
  desc?:    string;
  action?:  ReactNode;
}

export function EmptyState({ icon, title, desc, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center
                    bg-white rounded-3xl border border-slate-200/80 shadow-xs">
      <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-3xl mb-4 shadow-2xs">
        {icon}
      </div>
      <h3 className="text-base font-bold text-charcoal-800 mb-1">{title}</h3>
      {desc && <p className="text-xs text-slate-500 mb-6 max-w-sm leading-relaxed">{desc}</p>}
      {action}
    </div>
  );
}
