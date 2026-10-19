// A "%" shown inside a percent box, right after the centred number. Display
// only — the input's value stays a plain number. The overlay repeats the
// value invisibly with a hidden "%" in front, so the number lines up with the
// input's own and the visible "%" lands just after it. A blank box lines the
// "%" up after its placeholder instead.
//
// `className` sizes the wrapper (give the input w-full inside it);
// `textClassName` must match the input's font size, `color` its text colour.
export function PctBox({
  value,
  placeholder = "",
  className = "block",
  textClassName = "text-sm",
  color,
  children,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  textClassName?: string;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`relative ${className}`}>
      {children}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 flex items-center justify-center whitespace-pre text-foreground ${textClassName}`}
        style={color ? { color } : undefined}
      >
        <span className="invisible">%{value.trim() ? value : placeholder}</span>%
      </span>
    </span>
  );
}
