import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { MonthPicker } from './MonthPicker';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-indigo-600 text-white shadow' : 'text-indigo-700 hover:bg-indigo-50 hover:text-indigo-900'
  }`;

type AppHeaderProps = {
  title: string;
  actions?: ReactNode;
};

export const AppHeader = ({ title, actions }: AppHeaderProps) => (
  <header className="border-b border-slate-200 bg-white shadow-sm">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <nav className="flex items-center gap-1">
          <NavLink to="/" className={navLinkClass}>
            Viewer
          </NavLink>
          <NavLink to="/config" className={navLinkClass}>
            Config
          </NavLink>
          <NavLink to="/wish-offs" className={navLinkClass}>
            WishOffs
          </NavLink>
        </nav>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <MonthPicker />
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  </header>
);
