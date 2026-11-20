import { providerInfo, type ProviderId } from '../../shared/providers';
import { PROVIDER_LOGOS } from './providerLogos';

/** A provider's tile: its official logo in white on the brand colour, or its monogram when no logo is available. */
export function ProviderMono({ id, size = 22 }: { id: ProviderId; size?: number }) {
  const p = providerInfo(id);
  const logo = PROVIDER_LOGOS[id];
  const style = { ['--pc' as string]: logo?.hex ?? p.color, width: size, height: size, fontSize: Math.round(size * 0.4), borderRadius: Math.round(size * 0.28) };
  return (
    <span className={`pv-mono ${logo ? 'logo' : ''} ${id}`} style={style} title={p.name} aria-label={p.name}>
      {logo ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} aria-hidden>
          <path d={logo.path} fill="currentColor" />
        </svg>
      ) : (
        p.mono
      )}
    </span>
  );
}
