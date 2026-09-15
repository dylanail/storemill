import { commerceTools } from './commerce.ts'
import { growthTools } from './growth.ts'
import { pluginTools } from './plugin-tools.ts'
import { productTools } from './products.ts'
import { researchTools } from './research.ts'
import { pageTools } from './pages.ts'
import { dropshipTools } from './dropship.ts'
import { storefrontTools } from './storefront.ts'
import { adTools } from './ads.ts'
import { planTools } from './plan.ts'
import { automationTools } from './automation.ts'

/** Importing this module is what populates the registry. */
export const ALL_TOOLS = [...productTools, ...researchTools, ...pageTools, ...dropshipTools, ...adTools, ...commerceTools, ...storefrontTools, ...growthTools, ...planTools, ...automationTools, ...pluginTools]
