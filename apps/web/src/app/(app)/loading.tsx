/** Shown while a page's data loads: the page's shape, so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <div className="flex flex-col lg:h-full" aria-busy="true" aria-label="Loading">
      <div className="px-6 pb-5 pt-7">
        <div className="skeleton h-7 w-56" />
        <div className="skeleton mt-3 h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 px-6 pb-5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-line bg-surface px-5 py-4">
            <div className="skeleton h-6 w-12" />
            <div className="skeleton mt-3 h-3.5 w-32" />
          </div>
        ))}
      </div>
      <div className="grid-card mx-6 mb-6 flex-1">
        <div className="flex gap-5 border-b border-line px-5 py-4">
          {[80, 64, 72].map((w) => (
            <div key={w} className="skeleton h-4" style={{ width: w }} />
          ))}
        </div>
        <div className="space-y-px">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-6 border-b border-line-2 px-5 py-4">
              <div className="skeleton h-4 w-72" />
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
