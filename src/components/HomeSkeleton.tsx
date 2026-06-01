/**
 * Loading placeholder for the homepage, shown while projection + topology load.
 * Pulsing blocks preview the real layout (hero number, hemicycle, scoreboard,
 * map) so the first paint isn't a bare spinner and there's no jump when data
 * arrives. Decorative shapes are aria-hidden; an sr-only status line + aria-busy
 * convey "loading" to assistive tech.
 */
export function HomeSkeleton() {
  return (
    <div
      className="max-w-6xl mx-auto w-full px-6 pt-4 sm:pt-6"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading the projection…</span>

      <div aria-hidden="true" className="animate-pulse">
        {/* Hero: headline + big number (left) and hemicycle arc (right). */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-10 lg:items-center">
          <div>
            <div className="h-9 sm:h-12 w-3/4 rounded-md bg-stone-200" />
            <div className="mt-3 h-9 sm:h-12 w-2/3 rounded-md bg-stone-200" />
            <div className="mt-6 h-14 w-40 rounded-md bg-stone-200" />
            <div className="mt-4 h-4 w-full max-w-md rounded bg-stone-100" />
            <div className="mt-2 h-4 w-5/6 max-w-md rounded bg-stone-100" />
          </div>
          <div className="mt-8 lg:mt-0 flex justify-center">
            {/* Faint hemicycle dome. */}
            <div className="h-40 w-80 max-w-full rounded-t-full bg-stone-200/70" />
          </div>
        </div>

        {/* Scoreboard: three cells. */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="h-3 w-24 rounded bg-stone-100" />
              <div className="mt-2 h-6 w-32 rounded bg-stone-200" />
              <div className="mt-2 h-1.5 w-full rounded-full bg-stone-100" />
            </div>
          ))}
        </div>

        {/* Map placeholder. */}
        <div className="mt-4 h-[360px] sm:h-[460px] rounded-xl border border-stone-200 bg-white">
          <div className="m-4 h-full rounded-lg bg-stone-100" />
        </div>
      </div>
    </div>
  );
}
