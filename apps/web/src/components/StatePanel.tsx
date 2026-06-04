type Props = {
  state: unknown;
  updated?: boolean;
};

export function StatePanel({ state, updated }: Props) {
  const json = JSON.stringify(state, null, 2);
  return (
    <details className="state-panel">
      <summary>
        查看房间状态
        {updated ? <span className="state-panel__hint">已更新</span> : null}
      </summary>
      <pre className="state-panel__json">{json}</pre>
    </details>
  );
}
