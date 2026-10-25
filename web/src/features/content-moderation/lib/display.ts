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
import type { TFunction } from 'i18next'

import type { StatusVariant } from '@/components/status-badge'

import type { ModerationKeyStatus, ModerationLog, ModerationMode } from '../api'

export function moderationModeLabel(
  mode: ModerationMode,
  t: TFunction
): string {
  switch (mode) {
    case 'pre_block':
      return t('Pre-block')
    case 'observe':
      return t('Observe only')
    default:
      return t('Off')
  }
}

export function moderationResultBadge(
  entry: Pick<ModerationLog, 'action' | 'flagged'>,
  t: TFunction
): { label: string; variant: StatusVariant } {
  switch (entry.action) {
    case 'block':
      return { label: t('Blocked'), variant: 'danger' }
    case 'keyword_block':
      return { label: t('Keyword blocked'), variant: 'danger' }
    case 'hash_block':
      return { label: t('Hash blocked'), variant: 'danger' }
    case 'cyber_policy':
      return { label: t('Cyber policy'), variant: 'danger' }
    case 'judge_block':
      return { label: t('Judge blocked'), variant: 'danger' }
    case 'error':
      return { label: t('Moderation error'), variant: 'warning' }
    default:
      return entry.flagged
        ? { label: t('Hit'), variant: 'warning' }
        : { label: t('Passed'), variant: 'success' }
  }
}

export function keyStatusBadge(
  status: ModerationKeyStatus['status'],
  t: TFunction
): { label: string; variant: StatusVariant } {
  switch (status) {
    case 'ok':
      return { label: t('Healthy'), variant: 'success' }
    case 'frozen':
      return { label: t('Frozen'), variant: 'danger' }
    case 'error':
      return { label: t('Error'), variant: 'warning' }
    default:
      return { label: t('Unchecked'), variant: 'neutral' }
  }
}

export function formatPercent(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

export function parseScoreMap(raw: string): [string, number][] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    return Object.entries(parsed).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number'
    )
  } catch {
    return []
  }
}
