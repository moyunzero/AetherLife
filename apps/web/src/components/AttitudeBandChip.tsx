import { bandLabelZh, type AttitudeBand } from "@aetherlife/shared";

type Props = {
  band: AttitudeBand;
  npcName: string;
};

export function AttitudeBandChip({ band, npcName }: Props) {
  const label = bandLabelZh(band);
  return (
    <span
      className={`attitude-band-chip attitude-band-chip--${band}`}
      data-testid="attitude-band-chip"
      data-band={band}
      aria-live="polite"
      aria-label={`${npcName}对你的态度：${label}`}
    >
      {label}
    </span>
  );
}
