/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import type { ModerationStatus } from '../api'
import { keyStatusBadge, moderationModeLabel } from '../lib/display'
import { MetricTile } from './metric-tile'

export function PreBlockPanels(props: { status: ModerationStatus }) {
  const { t } = useTranslation()
  const status = props.status
  const maxTotal = Math.max(
    1,
    ...status.api_key_loads.map((load) => load.total)
  )

  return (
    <div className='grid grid-cols-1 gap-3 xl:grid-cols-2'>
      <Card size='sm'>
        <CardHeader>
          <CardTitle>{t('Pre-block sync status')}</CardTitle>
          <CardDescription>
            {t(
              'Live counters of the synchronous check path; async record writes are not included.'
            )}
          </CardDescription>
          <CardAction>
            <StatusBadge
              label={moderationModeLabel(status.mode, t)}
              variant='info'
              copyable={false}
            />
          </CardAction>
        </CardHeader>
        <CardContent className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
          <MetricTile
            tone='info'
            label={t('Processing')}
            value={status.pre_block_active}
            hint={t('Being checked now')}
          />
          <MetricTile
            tone='neutral'
            label={t('Checked')}
            value={status.pre_block_checked}
            hint={t('Entered the pre-block path')}
          />
          <MetricTile
            tone='success'
            label={t('Allowed')}
            value={status.pre_block_allowed}
            hint={t('No block triggered')}
          />
          <MetricTile
            tone='destructive'
            label={t('Blocked')}
            value={status.pre_block_blocked}
            hint={t('Rejected after a hit')}
          />
          <MetricTile
            tone='warning'
            label={t('Moderation errors')}
            value={status.pre_block_errors}
            hint={t('Failed or no usable key')}
          />
          <MetricTile
            tone='primary'
            label={t('Average latency')}
            value={`${status.pre_block_avg_latency_ms} ms`}
            hint={t('Sync path average')}
          />
        </CardContent>
      </Card>

      <Card size='sm'>
        <CardHeader>
          <CardTitle>{t('Moderation key load')}</CardTitle>
          <CardDescription>
            {t('Synchronous pre-block checks rotate through available keys.')}
          </CardDescription>
          <CardAction className='text-muted-foreground text-xs tabular-nums'>
            {t(
              'Active {{active}} / available keys {{available}}, total {{total}} calls, workers {{workers}}/{{max}}',
              {
                active: status.api_key_active,
                available: status.api_key_available_count,
                total: status.api_key_total_calls,
                workers: status.worker_count,
                max: status.max_workers,
              }
            )}
          </CardAction>
        </CardHeader>
        <CardContent className='flex flex-col gap-2'>
          {status.api_key_loads.length === 0 && (
            <p className='text-muted-foreground py-6 text-center text-sm'>
              {t('No moderation API key configured')}
            </p>
          )}
          {status.api_key_loads.map((load) => {
            const badge = keyStatusBadge(load.status, t)
            return (
              <div key={load.key_hash} className='bg-muted/40 rounded-lg p-3'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <span className='text-muted-foreground text-xs'>
                      #{load.index}
                    </span>
                    <span className='truncate font-mono text-sm'>
                      {load.masked}
                    </span>
                    <StatusBadge
                      label={badge.label}
                      variant={badge.variant}
                      copyable={false}
                    />
                  </div>
                  <div className='grid grid-cols-4 gap-4 text-right text-xs tabular-nums'>
                    {[
                      [t('Active'), load.active],
                      [t('Total'), load.total],
                      [t('Average'), `${load.avg_latency_ms} ms`],
                      [t('Latest'), `${load.last_latency_ms} ms`],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <div className='text-muted-foreground'>{label}</div>
                        <div className='font-semibold'>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className='text-muted-foreground mt-1 text-xs'>
                  {t(
                    'Total {{total}}, success {{success}}, errors {{errors}}',
                    {
                      total: load.total,
                      success: load.success,
                      errors: load.errors,
                    }
                  )}
                </div>
                <Progress
                  className='mt-2'
                  value={(load.total / maxTotal) * 100}
                  aria-label={t('Share of calls for key {{index}}', {
                    index: load.index,
                  })}
                />
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

export function WorkerPanel(props: { status: ModerationStatus }) {
  const { t } = useTranslation()
  const status = props.status
  const workers = Array.from({ length: status.max_workers }, (_, index) => {
    let state = 'idle'
    if (index >= status.worker_count) {
      state = 'disabled'
    } else if (index < status.active_workers) {
      state = 'active'
    }
    return { id: index + 1, state }
  })

  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle>{t('Worker status')}</CardTitle>
        <CardDescription>
          {t('Observe mode checks requests asynchronously in a bounded queue.')}
        </CardDescription>
      </CardHeader>
      <CardContent className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <div className='flex flex-col gap-3'>
          <div>
            <div className='mb-1 flex justify-between text-xs'>
              <span className='text-muted-foreground'>{t('Queue usage')}</span>
              <span className='tabular-nums'>
                {status.queue_length} / {status.queue_size} (
                {status.queue_usage_percent.toFixed(1)}%)
              </span>
            </div>
            <Progress
              value={status.queue_usage_percent}
              aria-label={t('Queue usage')}
            />
          </div>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
            <MetricTile
              tone='info'
              label={t('Active')}
              value={status.active_workers}
            />
            <MetricTile
              tone='success'
              label={t('Idle')}
              value={status.idle_workers}
            />
            <MetricTile
              tone='neutral'
              label={t('Processed')}
              value={status.processed}
            />
            <MetricTile
              tone='warning'
              label={t('Dropped / errors')}
              value={`${status.dropped} / ${status.async_errors}`}
            />
          </div>
        </div>
        <div className='flex flex-col gap-2'>
          <div
            className='grid grid-cols-8 gap-1.5'
            role='list'
            aria-label={t('Workers')}
          >
            {workers.map((worker) => (
              <span
                key={worker.id}
                role='listitem'
                aria-label={`#${worker.id} ${worker.state}`}
                className={cn(
                  'h-6 rounded',
                  worker.state === 'active' && 'bg-info',
                  worker.state === 'idle' && 'bg-success/60',
                  worker.state === 'disabled' && 'bg-muted'
                )}
              />
            ))}
          </div>
          <p className='text-muted-foreground text-xs'>
            {status.last_cleanup_at > 0
              ? t('Last cleanup {{time}}', {
                  time: dayjs
                    .unix(status.last_cleanup_at)
                    .format('YYYY-MM-DD HH:mm:ss'),
                })
              : t('No cleanup has run yet')}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
