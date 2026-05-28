export default function VoxylHeader({ title, subtitle, right }) {
  return (
    <div
      className="flex items-center justify-between px-4 pb-4 select-none"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3rem)' }}
    >
      <div>
        {subtitle && <p className="text-xs text-muted-foreground mb-0.5">{subtitle}</p>}
        <div className="flex items-baseline gap-1.5">
          <h1 className="text-2xl font-grotesk font-bold text-foreground">{title}</h1>
          <span className="text-[10px] text-muted-foreground/50 font-mono leading-none">v2.0.0</span>
        </div>
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}