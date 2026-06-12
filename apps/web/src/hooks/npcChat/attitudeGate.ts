export function attitudeGateHintCopy(npcName: string, gateKind?: string): string {
  switch (gateKind) {
    case "transfer":
      return `${npcName}拒绝配合这个请求。`;
    case "interact":
    case "generic":
      return `${npcName}现在不愿意帮忙。`;
    case "move":
    default:
      return `${npcName}似乎不愿协助你移动。`;
  }
}
