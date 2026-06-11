import { BIOME_LABEL_ZH, chunkOf, type BiomeId } from "@aetherlife/shared";

type Props = {
  gx: number;
  gy: number;
  biome: BiomeId | "void";
  placeName?: string;
  flavorLine?: string;
  lorePending?: boolean;
  gameClockLabel?: string;
  /** WorldRegion registry labelZh for player cell (LIFE-EXT-UI-04). */
  regionLabelZh?: string;
};

export function ExploreCoordsStrip({
  gx,
  gy,
  biome,
  placeName,
  flavorLine,
  lorePending,
  gameClockLabel,
  regionLabelZh,
}: Props) {
  const { cx, cy } = chunkOf(gx, gy);
  const biomeLabel = biome === "void" ? "生成中" : BIOME_LABEL_ZH[biome];
  const displayPlace = placeName ?? biomeLabel;

  return (
    <div className="explore-coords-strip" data-testid="explore-coords-strip" aria-live="polite">
      <p data-testid="explore-place-name">
        {displayPlace}
        {flavorLine ? ` · ${flavorLine}` : null}
      </p>
      <p className="explore-coords-strip__meta">
        格 ({gx}, {gy}) · chunk ({cx}, {cy}) · {biomeLabel}
        {regionLabelZh ? (
          <>
            {" · "}
            <span data-testid="explore-region-label">{regionLabelZh}</span>
          </>
        ) : null}
      </p>
      {gameClockLabel ? (
        <p className="explore-coords-strip__clock" aria-label={`游戏时间 ${gameClockLabel}`}>
          游戏时间{" "}
          <span data-testid="explore-game-clock">{gameClockLabel}</span>
        </p>
      ) : null}
      {lorePending ? (
        <p className="explore-coords-strip__pending" data-testid="lore-pending-hint">
          正在书写这片土地…
        </p>
      ) : null}
    </div>
  );
}
