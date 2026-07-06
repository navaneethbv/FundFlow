export default function RadialGauge({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <svg viewBox="0 0 56 56" className="h-14 w-14" aria-hidden="true">
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke="var(--panel-hover)"
        strokeWidth="8"
      />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke="var(--accent-2)"
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="round"
        strokeWidth="8"
        transform="rotate(-90 28 28)"
      />
    </svg>
  );
}
