import { Link, NavLink } from 'react-router-dom';
import { StateSearch } from './StateSearch';

export function Masthead() {
  // Note: the site brand sits in a <span>, not an <h1>. Each page owns its
  // own <h1> (the topical phrase) so Google sees a single, page-specific
  // primary heading per route. Demoting the brand to a span is purely
  // semantic — visual styling matches the old h1 exactly.
  return (
    <header className="bg-brand-cream">
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Link to="/" className="flex items-center gap-4 flex-shrink-0 group" aria-label="The Proportional House — home">
          <img
            src="/logomark.svg"
            alt=""
            width="56"
            height="56"
            className="w-10 h-10 sm:w-14 sm:h-14"
          />
          <div>
            <span className="block font-serif text-[22px] sm:text-[32px] font-medium text-brand-navy leading-[1.05] tracking-tight group-hover:opacity-90">
              The Proportional House
            </span>
            <span className="block font-serif italic text-xs sm:text-sm text-stone-600 leading-snug mt-0.5">
              Mapping the U.S. House under proportional representation
            </span>
          </div>
        </Link>
        {/* On mobile the right group drops to its own row at full width so
         * the search input has room to breathe and the nav can wrap without
         * fighting the logo block. On sm+ it collapses back to the inline
         * pattern with ml-auto pushing it to the right of the logo. */}
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap">
          <StateSearch />
          <nav className="flex items-center gap-1 text-sm flex-wrap" aria-label="Primary">
            <MastheadNavLink to="/">Map</MastheadNavLink>
            <MastheadNavLink to="/rankings">Rankings</MastheadNavLink>
            <MastheadNavLink to="/methodology">Methodology</MastheadNavLink>
            <MastheadNavLink to="/about">About</MastheadNavLink>
          </nav>
        </div>
      </div>
    </header>
  );
}

function MastheadNavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'px-3 py-1 rounded',
          isActive
            ? 'bg-brand-navy text-white'
            : 'text-stone-600 hover:bg-stone-200/60',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
  );
}
