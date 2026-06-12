/**
 * Root-level verify scripts cannot resolve workspace package names unless the root
 * package.json declares @aetherlife/shared. Re-export from built dist instead.
 */
export {
  COLYSEUS_MAX_CLIENTS,
  COLYSEUS_SERVER_MESSAGES,
} from "../../packages/shared/dist/index.js";
