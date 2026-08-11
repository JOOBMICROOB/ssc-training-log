/** Athlete avatar — their uploaded photo, or their initial as a fallback. */
export function Avatar({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className="cc-avatar-pic" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {src ? <img src={src} alt="" /> : initial}
    </span>
  );
}
