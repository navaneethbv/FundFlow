export default function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);

  return (
    <div className="flex h-11 items-end gap-1.5" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="w-2.5 rounded-t bg-accent"
          style={{ height: `${Math.max(18, (value / max) * 44)}px`, opacity: 0.42 + index * 0.08 }}
        />
      ))}
    </div>
  );
}
