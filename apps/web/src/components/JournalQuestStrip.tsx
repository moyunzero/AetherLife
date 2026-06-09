type Props = {
  storyHook: string;
};

export function JournalQuestStrip({ storyHook }: Props) {
  const hook = storyHook.trim();
  if (!hook) return null;

  return (
    <div className="journal-quest-strip" data-testid="journal-quest-strip" aria-live="polite">
      <span className="journal-quest-strip__label">当前线索</span>
      <p className="journal-quest-strip__hook" data-testid="journal-quest-hook">
        {hook}
      </p>
    </div>
  );
}
