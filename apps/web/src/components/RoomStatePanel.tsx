type Props = {
  state: unknown;
  activeNpcId: string;
  updated?: boolean;
};

export function RoomStatePanel({ state, activeNpcId, updated }: Props) {
  const json = JSON.stringify(state, null, 2);
  return (
    <details className="state-panel">
      <summary>
        查看房间状态
        {updated ? <span className="state-panel__hint">已更新</span> : null}
      </summary>
      <p className="state-panel__active">当前对话 NPC：{activeNpcId}</p>
      <pre className="state-panel__json">{json}</pre>
    </details>
  );
}
