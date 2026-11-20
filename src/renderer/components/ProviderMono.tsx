import { providerInfo, type ProviderId } from '../../shared/providers';

/** A provider's tile: its monogram on its colour (no third-party logos). */
export function ProviderMono({ id, size = 22 }: { id: ProviderId; size?: number }) {
  const p = providerInfo(id);
  return (
    <span className="pv-mono" style={{ ['--pc' as string]: p.color, width: size, height: size, fontSize: Math.round(size * 0.4), borderRadius: Math.round(size * 0.28) }} title={p.name} aria-label={p.name}>
      {p.mono}
    </span>
  );
}
