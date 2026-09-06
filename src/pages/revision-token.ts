import { createHash } from 'node:crypto'
import type { Page } from './store.ts'
/** Content hash catches simultaneous saves even when timestamps collide. */
export function pageRevisionToken(page:Page):string{return createHash('sha256').update(JSON.stringify(page)).digest('hex')}
