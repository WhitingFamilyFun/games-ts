import { GameRegistry } from "./engine.js"
import { flyloFunctions } from "./flylo/index.js"
import { flixxFunctions } from "./flixx/index.js"

export const registerAllGames = (): void => {
  GameRegistry.register(flyloFunctions)
  GameRegistry.register(flixxFunctions)
}
