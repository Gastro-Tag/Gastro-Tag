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
                    bg-white rounded-lg border border-slate-200">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-800 mb-1">{title}</h3>
      {desc && <p className="text-sm text-slate-500 mb-6 max-w-xs">{desc}</p>}
      {action}
    </div>
  );
}
