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

type ReasonSource = {
  source?: string
  matched_keyword?: string
  category?: string
  score?: number
}

export function moderationReason(entry: ReasonSource, t: TFunction): string {
  if (entry.source === 'keyword') {
    return t('Keyword: {{keyword}}', { keyword: entry.matched_keyword ?? '' })
  }
  if (entry.source === 'openai' && entry.category) {
    return t('{{category}} (score {{score}})', {
      category: entry.category,
      score: (entry.score ?? 0).toFixed(3),
    })
  }
  if (entry.source === 'admin') return t('Unbanned by administrator')
  return entry.source ?? ''
}

export function moderationActionBadge(
  action: string,
  t: TFunction
): { label: string; variant: StatusVariant } {
  switch (action) {
    case 'block':
      return { label: t('Blocked'), variant: 'danger' }
    case 'observe':
      return { label: t('Observed'), variant: 'warning' }
    case 'unban':
      return { label: t('Unbanned'), variant: 'success' }
    default:
      return { label: action, variant: 'neutral' }
  }
}
