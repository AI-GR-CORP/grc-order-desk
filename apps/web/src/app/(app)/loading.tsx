/** Shown while a page's data loads: the page's shape, so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <div className="flex flex-col lg:h-full" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3 px-5 pb-3 pt-4">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-6 w-36 rounded-full" />
      </div>
      <div className="grid-card mx-5 mb-5 flex-1">
        <div className="flex items-center gap-5 border-b border-line px-4 py-3.5">
          {[120, 80, 70].map((w) => (
            <div key={w} className="skeleton h-4" style={{ width: w }} />
          ))}
          <div className="skeleton ml-auto h-8 w-52" />
        </div>
        <div>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex items-center gap-6 border-b border-line-2 px-5 py-4">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-4 w-64" />
              <div className="skeleton h-4 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
