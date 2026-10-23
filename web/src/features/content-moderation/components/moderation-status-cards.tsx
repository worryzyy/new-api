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
import { FileText, KeyRound, ShieldCheck, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'

import type { ModerationConfigView, ModerationStatus } from '../api'
import { moderationModeLabel } from '../lib/display'

export function ModerationStatusCards(props: {
  status?: ModerationStatus
  config?: ModerationConfigView
  logTotal?: number
  loading: boolean
}) {
  const { t } = useTranslation()
  const config = props.config
  const active = !!config?.enabled && config.mode !== 'off'
  const keyCount = config?.api_key_count ?? 0
  const available = props.status?.api_key_available_count ?? 0

  let scopeValue = t('All groups')
  if (config && !config.all_groups) {
    scopeValue = t('{{count}} groups', { count: config.groups.length })
  }
  let modelScope = t('All models')
  if (config?.model_filter.type === 'include') {
    modelScope = t('{{count}} models included', {
      count: config.model_filter.models.length,
    })
  } else if (config?.model_filter.type === 'exclude') {
    modelScope = t('{{count}} models excluded', {
      count: config.model_filter.models.length,
    })
  }

  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
      <StatCard
        title={t('Running status')}
        value={active ? t('Enabled') : t('Disabled')}
        description={config ? moderationModeLabel(config.mode, t) : ''}
        icon={ShieldCheck}
        iconTone={active ? 'success' : 'neutral'}
        loading={props.loading}
        action={
          <StatusBadge
            label={active ? t('Running') : t('Stopped')}
            variant={active ? 'success' : 'neutral'}
            copyable={false}
          />
        }
      />
      <StatCard
        title={t('API key')}
        value={t('{{count}} keys', { count: keyCount })}
        description={
          keyCount > 0
            ? t('{{count}} available', { count: available })
            : (config?.model ?? '')
        }
        icon={KeyRound}
        iconTone={keyCount > 0 && available === 0 ? 'warning' : 'info'}
        loading={props.loading}
      />
      <StatCard
        title={t('Audit scope')}
        value={scopeValue}
        description={modelScope}
        icon={Users}
        iconTone='chart-4'
        loading={props.loading}
      />
      <StatCard
        title={t('Audit records')}
        value={props.logTotal ?? 0}
        description={t('Current filter results')}
        icon={FileText}
        iconTone='warning'
        loading={props.loading}
      />
    </div>
  )
}
