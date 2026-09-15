import { getStore } from '../../control/stores.ts'
import { getOrder } from '../../domain/orders.ts'
import { trackingFor } from '../../domain/ops.ts'
import { format } from '../../lib/money.ts'
import { generateVersions } from '../../pages/versions.ts'
import { analyzeExperiment, listExperiments, promoteExperiment, rollbackExperiment, startPdpExperiment } from '../../analytics/experiments.ts'
import { syncOrderTracking } from '../../shipping/seventeen-track.ts'
import { defineTools, type Tool } from '../registry.ts'

export const automationTools: Tool[] = defineTools([
  {
    name: 'start_conversion_test',
    area: 'analytics',
    description: 'Generate two to four product-page angles, split traffic between them, and start a Bayesian conversion test with optional automatic promotion.',
    schema: {
      productId: { type: 'string', required: true },
      hypothesis: { type: 'string' },
      count: { type: 'number', integer: true, min: 2, max: 4, default: 3 },
      minViews: { type: 'number', integer: true, min: 25, max: 10000, default: 75 },
      autoPromote: { type: 'boolean', default: true },
      model: { type: 'string', help: 'Optional provider:model override for this run.' },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No such store')
      const pages = await generateVersions(ctx.db, store, { productId: args.productId as string, kind: 'pdp', count: args.count as number, publish: true, ...(args.model ? { model: args.model as string } : {}) })
      const experiment = startPdpExperiment(ctx.db, ctx.storeId, {
        productId: args.productId as string,
        pageIds: pages.map((page) => page.id),
        hypothesis: args.hypothesis as string,
        minViews: args.minViews as number,
        autoPromote: args.autoPromote as boolean,
      })
      return { summary: `Started ${experiment.name} across ${pages.length} page angles. It will wait for ${experiment.results.minViews} views per version and ${(experiment.results.confidence * 100).toFixed(0)}% probability before choosing.`, data: experiment, artifacts: [{ type: 'link', href: '/admin/cro', label: 'Open experiments' }] }
    },
  },
  {
    name: 'list_experiments',
    area: 'analytics',
    description: 'List conversion experiments, their evidence status and current leader.',
    schema: {},
    handler(_args, ctx) {
      const experiments = listExperiments(ctx.db, ctx.storeId)
      return {
        summary: experiments.length ? `${experiments.length} experiment${experiments.length === 1 ? '' : 's'}; ${experiments.filter((entry) => ['running', 'ready', 'paused'].includes(entry.status)).length} active.` : 'No conversion experiments yet.',
        data: experiments,
        artifacts: [{ type: 'table', columns: ['Experiment', 'Status', 'Leader', 'Why'], rows: experiments.map((entry) => {
          const leader = [...(entry.results.variants ?? [])].sort((a, b) => b.probabilityBest - a.probabilityBest)[0]
          return [entry.name, entry.status, leader ? `${leader.title} (${(leader.probabilityBest * 100).toFixed(1)}%)` : '—', entry.results.reason ?? 'Not evaluated']
        }) }, { type: 'link', href: '/admin/cro', label: 'Open experiments' }],
      }
    },
  },
  {
    name: 'evaluate_experiment',
    area: 'analytics',
    description: 'Recalculate one conversion experiment using all evidence collected so far.',
    schema: { experimentId: { type: 'string', required: true } },
    handler(args, ctx) {
      const experiment = analyzeExperiment(ctx.db, ctx.storeId, args.experimentId as string)
      return { summary: experiment.status === 'promoted' ? `${experiment.name} met its guardrails and the winner was promoted.` : experiment.results.reason ?? 'Experiment recalculated.', data: experiment, artifacts: [{ type: 'link', href: '/admin/cro', label: 'See the evidence' }] }
    },
  },
  {
    name: 'promote_experiment_winner',
    area: 'analytics',
    description: 'Send 100% of product-page traffic to an evidence-backed experiment winner. The old weights remain available for rollback.',
    risk: 'confirm',
    schema: { experimentId: { type: 'string', required: true } },
    handler(args, ctx) {
      const experiment = promoteExperiment(ctx.db, ctx.storeId, args.experimentId as string)
      return { summary: `Promoted the winner of ${experiment.name}; prior traffic weights are saved.`, data: experiment }
    },
  },
  {
    name: 'rollback_experiment',
    area: 'analytics',
    description: 'Restore the exact page traffic weights from before an experiment was promoted.',
    risk: 'confirm',
    schema: { experimentId: { type: 'string', required: true } },
    handler(args, ctx) {
      const experiment = rollbackExperiment(ctx.db, ctx.storeId, args.experimentId as string)
      return { summary: `Rolled back ${experiment.name} to its exact previous traffic split.`, data: experiment }
    },
  },
  {
    name: 'track_order',
    area: 'orders',
    description: 'Get the latest 17TRACK carrier status and event history for an order number or id.',
    schema: { orderId: { type: 'string', required: true } },
    async handler(args, ctx) {
      const order = getOrder(ctx.db, ctx.storeId, args.orderId as string)
      if (!order) throw new Error('No such order')
      const snapshot = await syncOrderTracking(ctx.db, ctx.storeId, order)
      const view = trackingFor(ctx.db, ctx.storeId, order, snapshot)
      const latest = view.live?.events[0]
      return {
        summary: view.tracking
          ? `Order #${order.displayId}: ${view.live?.subStatus || view.live?.status || order.fulfillmentStatus}${latest?.description ? ` — ${latest.description}` : ''}. Tracking ${view.tracking.number} with ${view.tracking.carrier}.`
          : `Order #${order.displayId} has no tracking number yet.`,
        data: view,
        artifacts: [{ type: 'table', columns: ['When', 'Update', 'Location'], rows: (view.live?.events ?? []).slice(0, 10).map((event) => [event.at, event.description, event.location]) }, { type: 'link', href: `/admin/orders/${order.id}`, label: `Order #${order.displayId} · ${format(order.totalCents, order.currency)}` }],
      }
    },
  },
  {
    name: 'download_store_backup',
    area: 'setup',
    description: 'Give the owner the authenticated download link for a complete store-scoped JSON backup.',
    schema: {},
    handler() {
      return { summary: 'The backup is ready from Settings. It includes store commerce, content, analytics and configuration, but no login sessions.', artifacts: [{ type: 'link', href: '/admin/settings/export', label: 'Download store backup' }] }
    },
  },
])
