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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'
import dayjs from '@/lib/dayjs'

import type { ModerationLog } from '../api'
import {
  formatPercent,
  moderationResultBadge,
  parseScoreMap,
} from '../lib/display'

export function ModerationLogDetailsDialog(props: { entry: ModerationLog }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const entry = props.entry
  const badge = moderationResultBadge(entry, t)
  const scores = parseScoreMap(entry.category_scores).sort(
    (a, b) => b[1] - a[1]
  )
  const thresholds = Object.fromEntries(parseScoreMap(entry.threshold_snapshot))
  let sourceLabel = '—'
  if (entry.source === 'openai') sourceLabel = 'OpenAI'
  if (entry.source === 'keyword') sourceLabel = t('Keyword')
  if (entry.source === 'hash') sourceLabel = t('Flagged content hash')
  if (entry.source === 'upstream') sourceLabel = t('Upstream response')
  const isCyber = entry.action === 'cyber_policy'

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Audit record details')}
      description={t('View the complete details for this log entry')}
      descriptionClassName='sr-only'
      trigger={
        <button
          type='button'
          className='hover:text-primary line-clamp-2 max-w-60 cursor-pointer text-left text-xs break-words underline-offset-2 hover:underline'
        >
          {entry.input_excerpt || entry.error || t('Details')}
        </button>
      }
      contentClassName='min-w-0 sm:max-w-2xl max-sm:max-h-(--dialog-available-height) max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)]'
      titleClassName='text-base'
      contentHeight='auto'
      bodyClassName='space-y-3'
    >
      <p className='text-muted-foreground text-xs'>
        {t('Audit source: {{source}}', { source: sourceLabel })}
      </p>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        {[
          [
            t('Time'),
            dayjs.unix(entry.created_at).format('YYYY-MM-DD HH:mm:ss'),
          ],
          [
            t('User'),
            `${entry.user_email || entry.username || '—'} (#${entry.user_id})`,
          ],
          [
            t('Result'),
            <StatusBadge
              key='badge'
              label={badge.label}
              variant={badge.variant}
              copyable={false}
            />,
          ],
          [
            t('Highest risk'),
            entry.category
              ? `${entry.category} ${formatPercent(entry.score)}`
              : '—',
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className='bg-muted/40 min-w-0 rounded-lg p-2.5'
          >
            <div className='text-muted-foreground text-[11px]'>{label}</div>
            <div className='mt-1 truncate text-sm font-medium'>{value}</div>
          </div>
        ))}
        {entry.matched_keyword && (
          <div className='bg-destructive/10 col-span-2 rounded-lg p-2.5 sm:col-span-4'>
            <div className='text-muted-foreground text-[11px]'>
              {t('Matched keyword')}
            </div>
            <div className='text-destructive mt-1 text-sm font-medium break-words'>
              {entry.matched_keyword}
            </div>
          </div>
        )}
      </div>

      <DetailSection label={t('Input content')}>
        <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs'>
          <span className='font-mono'>{entry.endpoint || '—'}</span>
          <span>·</span>
          <span>{entry.model_name || '—'}</span>
          {entry.group_name && <GroupBadge group={entry.group_name} />}
        </div>
        <pre className='bg-muted mt-2 max-h-60 overflow-y-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap'>
          {(isCyber
            ? entry.input_excerpt
            : entry.error || entry.input_excerpt) || '—'}
        </pre>
      </DetailSection>

      {isCyber && (
        <DetailSection label={t('Upstream response')}>
          <pre className='bg-muted max-h-60 overflow-y-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap'>
            {entry.error || '—'}
          </pre>
        </DetailSection>
      )}

      {scores.length > 0 && (
        <DetailSection label={t('Category scores')}>
          {scores.map(([category, score]) => (
            <DetailRow
              key={category}
              label={category}
              value={`${formatPercent(score)}${category in thresholds ? ` / ${formatPercent(thresholds[category])}` : ''}`}
              mono
            />
          ))}
        </DetailSection>
      )}

      <DetailSection label={t('Request')}>
        {entry.token_name && (
          <DetailRow label={t('API Key')} value={entry.token_name} />
        )}
        {entry.request_id && (
          <DetailRow label={t('Request ID')} value={entry.request_id} mono />
        )}
        {entry.input_hash && (
          <DetailRow label={t('Content hash')} value={entry.input_hash} mono />
        )}
        {entry.violation_count > 0 && (
          <DetailRow
            label={t('Violation count')}
            value={entry.violation_count}
            mono
          />
        )}
        <DetailRow
          label={t('Latency')}
          value={`${entry.upstream_latency_ms} ms${entry.queue_delay_ms ? ` + ${t('Queue {{ms}} ms', { ms: entry.queue_delay_ms })}` : ''}`}
          mono
        />
      </DetailSection>
    </Dialog>
  )
}
